import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { WEEKDAYS, hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue, type VenueDoc } from '../../src/venues/venue.model';
import { Turf, type TurfDoc } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { Payment } from '../../src/bookings/payment.model';
import { openMinutes, overviewRanges } from '../../src/reports/overview';

const TZ = 'Asia/Dhaka';
// The test clock: 2026-01-01T00:00Z is 06:00 on Thursday 1 January in Dhaka.
const TODAY = '2026-01-01';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(), Booking.init(), Payment.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let venue: VenueDoc;
let court1: TurfDoc;
let court2: TurfDoc;
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
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  // Open 10 hours a day, every day.
  venue = await seedVenue(a.ownerId, { timezone: TZ, settings: { hours: Object.fromEntries(WEEKDAYS.map((d) => [d, { open: '08:00', close: '18:00' }])) } });
  court1 = await seedTurf(a.ownerId, venue.id as string, { name: 'Court A' });
  court2 = await seedTurf(a.ownerId, venue.id as string, { name: 'Court B' });
});

let refs = 0;
async function book(
  date: string,
  hm: string,
  over: Partial<{ turf: TurfDoc; status: string; source: string; hours: number; total: number; addons: number; paid: number; refunded: number; phone: string; fee: { amount: number; payer: 'player' | 'owner' } }> = {},
) {
  const startAt = localToUtc(date, hmToMin(hm), TZ);
  const endAt = new Date(startAt.getTime() + (over.hours ?? 1) * 3_600_000);
  const total = over.total ?? 1000;
  const addons = over.addons ?? 0;
  refs += 1;
  return Booking.create({
    ownerId: a.ownerId,
    venueId: venue._id,
    turfId: (over.turf ?? court1)._id,
    reference: `RPT${refs}`,
    businessDate: date,
    startAt,
    endAt,
    slots: [{ startAt, endAt, price: total - addons }],
    currency: 'BDT',
    subtotal: total - addons,
    addonsTotal: addons,
    total,
    advanceRequired: 0,
    amountPaid: over.paid ?? 0,
    amountRefunded: over.refunded ?? 0,
    status: over.status ?? 'confirmed',
    paymentStatus: 'unpaid',
    source: over.source ?? 'online',
    guest: { name: 'Guest', phone: over.phone ?? '+8801700000001' },
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
    platformFee: over.fee ? { mode: 'fixed', value: over.fee.amount / 100, payer: over.fee.payer, amount: over.fee.amount } : null,
  });
}

const overview = (days = 7, token = a.token) =>
  request(ctx.app).get(`/api/v1/owners/${a.ownerId}/reports/overview?venueId=${venue.id as string}&days=${days}`).set(...bearer(token));

describe('owner overview report', () => {
  it('periods end today in venue time', () => {
    expect(overviewRanges(7, ctx.services.now(), TZ)).toEqual({
      current: { from: '2025-12-26', to: TODAY },
      previous: { from: '2025-12-19', to: '2025-12-25' },
    });
    expect(openMinutes({ ...Object.fromEntries(WEEKDAYS.map((d) => [d, 'closed'])), thu: { open: '20:00', close: '02:00' } } as never, TODAY)).toBe(360);
  });

  it('sums revenue, hours, use and rates for the period and the one before', async () => {
    await book(TODAY, '09:00', { total: 1500, addons: 500, paid: 1500, phone: '+8801700000002' });
    await book(TODAY, '10:00', { source: 'walkin', hours: 2, total: 2000, paid: 500, turf: court2 });
    await book('2025-12-30', '17:00', { status: 'cancelled', total: 1000, paid: 1000, refunded: 700, phone: '+8801700000003' });
    await book('2025-12-30', '12:00', { status: 'expired' });
    await book('2025-12-20', '09:00', { total: 800, phone: '+8801700000004' });
    // Outside both periods: the first visit of the default guest.
    await book('2025-11-01', '09:00', { total: 999 });

    const res = await overview();
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.currency).toBe('BDT');
    expect(body.range).toMatchObject({ from: '2025-12-26', to: TODAY, days: 7 });
    // 3500 played + 300 kept from the cancellation.
    expect(body.kpis.revenue).toEqual({ value: 3800, previous: 800 });
    expect(body.kpis.bookings).toEqual({ value: 2, previous: 1 });
    expect(body.kpis.minutes).toEqual({ value: 180, previous: 60 });
    // Two courts open 10 h for 7 days.
    expect(body.kpis.utilization.value).toBeCloseTo(180 / (2 * 7 * 600));
    expect(body.kpis.averageBooking.value).toBe(1750);
    expect(body.kpis.cancellationRate.value).toBeCloseTo(1 / 3);

    const today = body.daily.at(-1);
    expect(today).toMatchObject({ date: TODAY, online: 1500, walkin: 2000, bookings: 2, minutes: 180 });
    expect(body.daily).toHaveLength(7);
    expect(body.daily[1].previous.revenue).toBe(800);

    expect(body.mix).toEqual({ courts: 3000, addons: 500, cancellationFees: 300, collected: 2300, outstanding: 1500 });
    // Thursday row: 1 h at 09:00, 2 h starting 10:00.
    expect(body.heatmap[3][9]).toBe(1);
    expect(body.heatmap[3][10]).toBe(2);
    expect(body.courts.map((c: { name: string; revenue: number }) => [c.name, c.revenue])).toEqual([
      ['Court B', 2000],
      ['Court A', 1800],
    ]);
    expect(body.statuses).toEqual({ confirmed: 2, cancelled: 1, expired: 1 });
    // Three customers this week (the expired one is not counted); two of them new, the old guest returning.
    expect(body.players).toEqual({ value: 3, previous: 1, newValue: 2, newPrevious: 1 });
    expect(body.recent).toHaveLength(6);
  });

  it('revenue is net of the platform fee', async () => {
    await book(TODAY, '09:00', { total: 105000, fee: { amount: 5000, payer: 'player' } });
    const res = await overview();
    expect(res.body.kpis.revenue.value).toBe(100000);
    expect(res.body.platformFees).toBe(5000);
  });

  it('owner-paid fee is deducted too', async () => {
    await book(TODAY, '09:00', { total: 100000, fee: { amount: 5000, payer: 'owner' } });
    const res = await overview();
    expect(res.body.kpis.revenue.value).toBe(95000);
    expect(res.body.platformFees).toBe(5000);
  });

  it('cancelled booking owes no fee', async () => {
    await book(TODAY, '09:00', { status: 'cancelled', total: 100000, paid: 30000, fee: { amount: 5000, payer: 'owner' } });
    const res = await overview();
    expect(res.body.kpis.revenue.value).toBe(30000);
    expect(res.body.platformFees).toBe(0);
  });

  it('splits payments by method, net of refunds', async () => {
    const b = await book(TODAY, '09:00', { paid: 1000 });
    const base = { ownerId: a.ownerId, venueId: venue._id, bookingId: b._id, currency: 'BDT', status: 'succeeded' };
    await Payment.create([
      { ...base, method: 'card', amount: 600, refundedAmount: 100 },
      { ...base, method: 'cash', amount: 400 },
      { ...base, method: 'cash', amount: 50, status: 'failed' },
    ]);
    const res = await overview();
    expect(res.body.methods).toEqual([
      { method: 'card', amount: 500, count: 1 },
      { method: 'cash', amount: 400, count: 1 },
    ]);
  });

  it('needs reports.view and a known venue; days is 7, 30 or 90', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    expect((await overview(7, staff.token)).status).toBe(403);
    expect((await overview(14)).status).toBe(400);
    const other = await request(ctx.app)
      .get(`/api/v1/owners/${a.ownerId}/reports/overview?venueId=0123456789abcdef01234567`)
      .set(...bearer(a.token));
    expect(other.status).toBe(404);
  });
});
