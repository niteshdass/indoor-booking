import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue, type VenueDoc } from '../../src/venues/venue.model';
import { Turf, type TurfDoc } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { Payment } from '../../src/bookings/payment.model';
import { csvCell, csvMoney } from '../../src/reports/csv';

const TZ = 'Asia/Dhaka';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(), Payment.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let venue: VenueDoc;
let court: TurfDoc;
beforeEach(async () => {
  const any = { crossTenant: true };
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Role.deleteMany({ ownerId: { $ne: null } }),
    Venue.deleteMany({}).setOptions(any),
    Turf.deleteMany({}).setOptions(any),
    Booking.deleteMany({}).setOptions(any),
    Payment.deleteMany({}).setOptions(any),
    ActivityLog.deleteMany({}).setOptions(any),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  venue = await seedVenue(a.ownerId, { name: 'Arena', slug: 'arena', timezone: TZ });
  court = await seedTurf(a.ownerId, venue.id as string, { name: 'Court A' });
});

let refs = 0;
async function book(date: string, hm: string, over: Partial<{ venue: VenueDoc; turf: TurfDoc; name: string; total: number; paid: number; coupon: string }> = {}) {
  const startAt = localToUtc(date, hmToMin(hm), TZ);
  const endAt = new Date(startAt.getTime() + 3_600_000);
  const total = over.total ?? 150050;
  refs += 1;
  return Booking.create({
    ownerId: a.ownerId,
    venueId: (over.venue ?? venue)._id,
    turfId: (over.turf ?? court)._id,
    reference: `CSV${refs}`,
    businessDate: date,
    startAt,
    endAt,
    slots: [{ startAt, endAt, price: total }],
    currency: 'BDT',
    subtotal: total,
    addonsTotal: 0,
    coupon: over.coupon ? { couponId: venue._id, code: over.coupon, discount: 500 } : null,
    total,
    advanceRequired: 0,
    amountPaid: over.paid ?? 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    source: 'walkin',
    guest: { name: over.name ?? 'Rahim, "Jr"', phone: '+8801700000001' },
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
  });
}

const get = (kind: string, query: string, token = a.token) =>
  request(ctx.app).get(`/api/v1/owners/${a.ownerId}/reports/${kind}.csv?${query}`).set(...bearer(token));

/** Lines of the file, the byte-order mark checked and dropped. */
function lines(text: string) {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return text.slice(1).trimEnd().split('\r\n');
}

describe('csv cells', () => {
  it('quotes, escapes and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+8801700000001')).toBe("'+8801700000001");
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
  it('writes money in major units', () => {
    expect(csvMoney(150050, 'BDT')).toBe('1500.50');
    expect(csvMoney(5, 'USD')).toBe('0.05');
    expect(csvMoney(0, 'BDT')).toBe('0.00');
    expect(csvMoney(1200, 'JPY')).toBe(1200);
  });
});

describe('bookings export', () => {
  it('lists the range in venue time with a header, as an attachment', async () => {
    await book('2026-01-02', '09:00', { paid: 50000, coupon: 'EID10' });
    await book('2026-01-01', '23:30', { name: 'Карим' });
    await book('2026-01-05', '09:00'); // outside the range

    const res = await get('bookings', `venueId=${venue.id as string}&from=2026-01-01&to=2026-01-02`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="bookings-arena-2026-01-01-to-2026-01-02.csv"');
    const [header, first, second, ...rest] = lines(res.text);
    expect(rest).toEqual([]);
    expect(header!.split(',').slice(0, 4)).toEqual(['Reference', 'Venue', 'Court', 'Date']);
    expect(first).toBe(
      "CSV2,Arena,Court A,2026-01-01,23:30,00:30,confirmed,unpaid,walkin,Карим,'+8801700000001,,BDT,1500.50,0.00,,0.00,,,1500.50,0.00,0.00,1500.50," +
        first!.split(',').at(-3) +
        ',,',
    );
    expect(second).toContain('"Rahim, ""Jr"""');
    expect(second).toContain(',EID10,5.00,');
    expect(second).toContain(',1500.50,500.00,0.00,1000.50,');

    const log = await ActivityLog.findOne({ action: 'report.exported' }).setOptions({ crossTenant: true });
    expect(log?.after).toEqual({ kind: 'bookings', from: '2026-01-01', to: '2026-01-02', rows: 2 });
  });

  it('covers every venue the member can see when no venue is named', async () => {
    const other = await seedVenue(a.ownerId, { name: 'Other', slug: 'other', timezone: TZ });
    const otherCourt = await seedTurf(a.ownerId, other.id as string, { name: 'Court Z' });
    await book('2026-01-01', '09:00');
    await book('2026-01-01', '10:00', { venue: other, turf: otherCourt });

    const all = await get('bookings', 'from=2026-01-01&to=2026-01-01');
    expect(all.headers['content-disposition']).toBe('attachment; filename="bookings-2026-01-01-to-2026-01-01.csv"');
    expect(lines(all.text)).toHaveLength(3);

    const manager = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [venue.id as string] });
    const scoped = lines((await get('bookings', 'from=2026-01-01&to=2026-01-01', manager.token)).text);
    expect(scoped).toHaveLength(2);
    expect(scoped[1]).toContain(',Arena,');
    expect((await get('bookings', `venueId=${other.id as string}&from=2026-01-01&to=2026-01-01`, manager.token)).status).toBe(404);
  });

  it('needs reports.view and a sane range', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    expect((await get('bookings', 'from=2026-01-01&to=2026-01-01', staff.token)).status).toBe(403);
    expect((await get('bookings', 'from=2026-01-02&to=2026-01-01')).status).toBe(400);
    expect((await get('bookings', 'from=2026-01-01&to=2027-01-02')).status).toBe(400);
    expect((await get('bookings', 'from=2026-01-01')).status).toBe(400);
    expect((await get('bookings', 'from=2026-01-01&to=2027-01-01')).status).toBe(200);
  });
});

describe('payments export', () => {
  it('lists payments by the venue-local day they were taken', async () => {
    const b = await book('2026-01-03', '09:00');
    const recorder = await User.findById(a.userId);
    const pay = (at: string, over: Record<string, unknown> = {}) =>
      Payment.create({ ownerId: a.ownerId, venueId: venue._id, bookingId: b._id, method: 'cash', amount: 50000, currency: 'BDT', status: 'succeeded', recordedBy: a.userId, ...over }).then((p) =>
        Payment.collection.updateOne({ _id: p._id }, { $set: { createdAt: new Date(at) } }),
      );
    // 23:00 on 31 Dec UTC is 05:00 on 1 Jan in Dhaka.
    await pay('2025-12-31T23:00:00Z', { refundedAmount: 10000 });
    await pay('2025-12-31T17:00:00Z'); // 23:00 on 31 Dec in Dhaka: outside
    await pay('2026-01-01T10:00:00Z', { method: 'wallet', kind: 'manual', provider: 'bkash', trxId: 'TRX9', senderNumber: '+8801999999999', status: 'pending', recordedBy: null });

    const res = await get('payments', `venueId=${venue.id as string}&from=2026-01-01&to=2026-01-01`);
    expect(res.status).toBe(200);
    const [header, cash, wallet, ...rest] = lines(res.text);
    expect(rest).toEqual([]);
    expect(header!.startsWith('Date,Time,Booking,Venue,Court,Customer,Method')).toBe(true);
    expect(cash).toBe(`2026-01-01,05:00,${b.reference},Arena,Court A,"Rahim, ""Jr""",cash,,,,succeeded,BDT,500.00,100.00,400.00,no,${recorder!.name},,`);
    expect(wallet).toContain(',wallet,bkash,TRX9,,pending,BDT,500.00,0.00,0.00,no,');
    // The sender number is staff-only and never leaves in a file.
    expect(res.text).not.toContain('8801999999999');
  });
});
