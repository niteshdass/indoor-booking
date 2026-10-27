import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { signAccessToken } from '../../src/auth/jwt';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { createBooking } from '../../src/bookings/create';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(), SlotOverride.init(), Addon.init(), AddonAssignment.init(), Booking.init(), SlotLock.init(),
    Payment.init(), Refund.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-10';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string, date = D) => localToUtc(date, hmToMin(hm), TZ);
const PHONE = '+8801711111111';

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let manager: Awaited<ReturnType<typeof addMember>>;
let v1: string;
let v2: string;
let t1: string;
let t2: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Closure, SlotOverride, Addon, AddonAssignment, Booking, SlotLock, Payment, Refund].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions({ crossTenant: true }),
    ),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  const settings = { hours: HOURS, bookingWindowDays: 365 };
  v1 = (await seedVenue(a.ownerId, { timezone: TZ, published: true, slug: 'v-one', settings })).id as string;
  v2 = (await seedVenue(a.ownerId, { timezone: TZ, published: true, slug: 'v-two', settings })).id as string;
  t1 = (await seedTurf(a.ownerId, v1, { pricing: { base: 1500, rules: [] } })).id as string;
  t2 = (await seedTurf(a.ownerId, v2, { pricing: { base: 1500, rules: [] } })).id as string;
  staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
  manager = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
});

const api = () => request(ctx.app);
const url = (rest: string, ownerId = a.ownerId) => `/api/v1/owners/${ownerId}${rest}`;
const walkinUrl = (venueId = v1, turfId = t1) => url(`/venues/${venueId}/turfs/${turfId}/bookings`);
const post = (path: string, token: string, body: object = {}) => api().post(url(path)).set(...bearer(token)).send(body);
const get = (path: string, token: string) => api().get(url(path)).set(...bearer(token));
const walkin = (token: string, over: Record<string, unknown> = {}, venueId = v1, turfId = t1) =>
  api()
    .post(walkinUrl(venueId, turfId))
    .set(...bearer(token))
    .send({
      date: D,
      startAts: [at('18:00').toISOString(), at('19:00').toISOString()],
      customer: { name: 'Walk In', phone: '+880 1711-111111' },
      payment: { method: 'unpaid' },
      ...over,
    });
/** Moves the clock and re-issues the members' access tokens, which would otherwise expire. */
async function setClock(iso: string) {
  ctx.services.clock.advance(Date.parse(iso) - ctx.services.now().getTime());
  for (const m of [a, staff, manager]) {
    const id = 'userId' in m ? m.userId : '';
    m.token = await signAccessToken(id, ctx.config.jwtSecret, ctx.services.now());
  }
}

/** A guest booking awaiting confirmation, with its locks, inserted directly. */
async function pendingBooking(over: { venueId?: string; turfId?: string; hm?: string; ownerId?: string } = {}) {
  const ownerId = over.ownerId ?? a.ownerId;
  const venueId = over.venueId ?? v1;
  const turfId = over.turfId ?? t1;
  const startAt = at(over.hm ?? '18:00');
  const endAt = new Date(startAt.getTime() + 3_600_000);
  const b = await Booking.create({
    ownerId, venueId, turfId, reference: `R${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
    businessDate: D, startAt, endAt, slots: [{ startAt, endAt, price: 1500 }], addons: [], currency: 'BDT',
    subtotal: 1500, addonsTotal: 0, total: 1500, advanceRequired: 0, amountPaid: 0, status: 'pending',
    paymentStatus: 'unpaid', source: 'online', guest: { name: 'Guest', phone: PHONE },
    policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
  });
  await SlotLock.create({ ownerId, turfId, startAt, bookingId: b._id });
  return b.id as string;
}

const gridSlot = async (hm: string) => {
  const res = await api().get(`/api/v1/venues/v-one/turfs/${t1}/slots`).query({ date: D });
  return (res.body.day.slots as { startAt: string; status: string }[]).find((s) => s.startAt === at(hm).toISOString())!;
};

describe('owner booking JSON', () => {
  it('list and detail responses carry customer and turf', async () => {
    const id = await pendingBooking();
    const turfName = (await Turf.findById(t1).setOptions({ crossTenant: true }))!.name;
    const list = await get(`/bookings?venueId=${v1}&from=${D}&to=${D}`, a.token);
    expect(list.body.bookings[0]).toMatchObject({ customer: { name: 'Guest', phone: PHONE }, turf: { name: turfName } });
    const one = await get(`/bookings/${id}`, a.token);
    expect(one.body.booking).toMatchObject({ customer: { name: 'Guest', phone: PHONE }, turf: { name: turfName } });
    expect(one.body.group).toEqual([]);
  });
});

describe('walk-in with cash', () => {
  it('records the booking and payment, logs both, links a real player', async () => {
    const res = await walkin(staff.token, { payment: { method: 'cash' } });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({
      status: 'confirmed', paymentStatus: 'paid', total: 3000, amountPaid: 3000, source: 'walkin',
      playerId: null, guest: { name: 'Walk In', phone: PHONE },
    });
    const one = await get(`/bookings/${res.body.booking.id}`, staff.token);
    expect(one.status).toBe(200);
    expect(one.body.payments).toHaveLength(1);
    expect(one.body.payments[0]).toMatchObject({ method: 'cash', amount: 3000, status: 'succeeded', recordedBy: staff.userId });
    const acts = await ActivityLog.find({ ownerId: a.ownerId }).lean();
    const byAction = Object.fromEntries(acts.map((r) => [r.action, r]));
    expect(String(byAction['booking.create']!.actorId)).toBe(staff.userId);
    expect(String(byAction['payment.cash']!.actorId)).toBe(staff.userId);
    expect(byAction['booking.create']!.after).toMatchObject({ status: 'confirmed', total: 3000 });
    expect((await Booking.findOne({ ownerId: a.ownerId }))!.createdBy!.toString()).toBe(staff.userId);

    const unknown = await walkin(staff.token, {
      startAts: [at('10:00').toISOString()],
      customer: { name: 'X', phone: PHONE, playerId: '000000000000000000000000' },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('player_not_found');

    const player = await User.create({ name: 'Player', email: 'p@test.local' });
    const linked = await walkin(staff.token, {
      startAts: [at('10:00').toISOString()],
      customer: { name: 'X', phone: PHONE, playerId: player.id },
    });
    expect(linked.status).toBe(201);
    const token = await signAccessToken(player.id as string, ctx.config.jwtSecret, ctx.services.now());
    const mine = await api().get('/api/v1/me/bookings').set(...bearer(token));
    expect(mine.body.bookings.map((b: { id: string }) => b.id)).toEqual([linked.body.booking.id]);
  });

  it('rejects a bad cash amount and a taken slot', async () => {
    const big = await walkin(staff.token, { payment: { method: 'cash', amount: 3001 } });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('invalid_amount');
    expect(await Booking.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    expect((await walkin(staff.token)).status).toBe(201);
    expect((await walkin(staff.token)).status).toBe(409);
  });

  it('cash walk-in on a zero total confirms without a payment', async () => {
    await Turf.updateOne({ _id: t1 }, { $set: { pricing: { base: 0, rules: [] } } }).setOptions({ crossTenant: true });
    const res = await walkin(staff.token, { payment: { method: 'cash' } });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', total: 0, amountPaid: 0 });
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    const acts = await ActivityLog.find({ ownerId: a.ownerId, action: /^(booking|payment)\./ }).lean();
    expect(acts.map((r) => r.action)).toEqual(['booking.create']);
  });
});

describe('walk-in on several courts and days', () => {
  it('books every run as one group, takes cash for each, logs each', async () => {
    const t3 = (await seedTurf(a.ownerId, v1, { pricing: { base: 1000, rules: [] } })).id as string;
    const D2 = '2026-01-11';
    const res = await walkin(staff.token, {
      payment: { method: 'cash' },
      more: [
        { turfId: t3, date: D, startAts: [at('18:00').toISOString()] },
        { date: D2, startAts: [at('10:00', D2).toISOString()] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.bookings).toHaveLength(3);
    expect(res.body.booking.id).toBe(res.body.bookings[0].id);
    const rows = await Booking.find({ ownerId: a.ownerId }).sort({ startAt: 1 }).lean();
    expect(new Set(rows.map((b) => String(b.groupId))).size).toBe(1);
    expect(rows.every((b) => b.source === 'walkin' && b.status === 'confirmed' && b.paymentStatus === 'paid')).toBe(true);
    expect(rows.map((b) => [String(b.turfId), b.businessDate, b.total]).sort()).toEqual(
      [[t1, D, 3000], [t1, D2, 1500], [t3, D, 1000]].sort(),
    );
    const payments = await Payment.find({ ownerId: a.ownerId }).lean();
    expect(payments.map((p) => p.amount).sort()).toEqual([1000, 1500, 3000]);
    expect(payments.every((p) => p.method === 'cash' && String(p.recordedBy) === staff.userId)).toBe(true);
    const acts = await ActivityLog.find({ ownerId: a.ownerId }).lean();
    expect(acts.filter((r) => r.action === 'booking.create')).toHaveLength(3);
    expect(acts.filter((r) => r.action === 'payment.cash')).toHaveLength(3);
    const one = await get(`/bookings/${res.body.booking.id}`, staff.token);
    expect(one.body.group.map((b: { id: string }) => b.id).sort()).toEqual(res.body.bookings.slice(1).map((b: { id: string }) => b.id).sort());
  });

  it('books none when one run is taken, and refuses an amount or a turf of another venue', async () => {
    const D2 = '2026-01-11';
    expect((await walkin(staff.token, { date: D2, startAts: [at('10:00', D2).toISOString()] })).status).toBe(201);
    const clash = await walkin(staff.token, { more: [{ date: D2, startAts: [at('10:00', D2).toISOString()] }] });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatchObject({ code: 'slot_taken', details: { date: D2 } });
    expect(await Booking.countDocuments({ ownerId: a.ownerId })).toBe(1);

    const amount = await walkin(staff.token, { payment: { method: 'cash', amount: 100 }, more: [{ date: D2, startAts: [at('12:00', D2).toISOString()] }] });
    expect(amount.status).toBe(400);
    const foreign = await walkin(staff.token, { more: [{ turfId: t2, date: D, startAts: [at('10:00').toISOString()] }] });
    expect(foreign.status).toBe(404);
    expect(await Booking.countDocuments({ ownerId: a.ownerId })).toBe(1);
  });

  it('the group page lists every booking, takes cash for all and cancels all', async () => {
    const D2 = '2026-01-11';
    const res = await walkin(staff.token, { payment: { method: 'unpaid' }, more: [{ date: D2, startAts: [at('10:00', D2).toISOString()] }] });
    const groupId = res.body.booking.groupId as string;
    const ids = res.body.bookings.map((b: { id: string }) => b.id);

    const one = await get(`/booking-groups/${groupId}`, staff.token);
    expect(one.status).toBe(200);
    expect(one.body.bookings.map((b: { id: string }) => b.id)).toEqual(ids);
    expect(one.body.refunds).toEqual([]);
    expect((await get('/booking-groups/0123456789abcdef01234567', staff.token)).status).toBe(404);
    expect((await get('/booking-groups/nope', staff.token)).status).toBe(404);

    const cash = await post(`/booking-groups/${groupId}/payments/cash`, staff.token);
    expect(cash.status).toBe(201);
    expect(cash.body.bookings.every((b: { paymentStatus: string; amountPaid: number; total: number }) => b.paymentStatus === 'paid' && b.amountPaid === b.total)).toBe(true);
    expect(await Payment.countDocuments({ ownerId: a.ownerId, method: 'cash' })).toBe(2);
    expect((await post(`/booking-groups/${groupId}/payments/cash`, staff.token)).body.error.code).toBe('already_paid');

    expect((await post(`/booking-groups/${groupId}/cancel`, staff.token)).status).toBe(403);
    const cancel = await post(`/booking-groups/${groupId}/cancel`, manager.token, { reason: 'rain' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.bookings.map((b: { status: string }) => b.status)).toEqual(['cancelled', 'cancelled']);
    expect(cancel.body.refunds).toHaveLength(2);
    expect((await get(`/booking-groups/${groupId}`, staff.token)).body.refunds).toHaveLength(2);
    expect((await post(`/booking-groups/${groupId}/cancel`, manager.token)).status).toBe(409);
  });
});

describe('walk-in atomicity and permissions', () => {
  it('a failing afterInsert hook leaves no booking, lock or payment', async () => {
    const venue = (await Venue.findOne({ ownerId: a.ownerId, _id: v1 }))!;
    const turf = (await Turf.findOne({ ownerId: a.ownerId, _id: t1 }))!;
    await expect(
      createBooking({
        venue, turf, date: D, startAts: [at('18:00')], selection: [], source: 'walkin', now: ctx.services.now(),
        who: { playerId: null, guest: { name: 'W', phone: PHONE }, createdBy: staff.userId },
        cash: { recordedBy: staff.userId },
        afterInsert: async () => {
          throw new Error('log failed');
        },
      }),
    ).rejects.toThrow('log failed');
    for (const m of [Booking, SlotLock, Payment]) {
      expect(await (m as typeof Booking).countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    }
  });

  it('cash walk-in also needs payment.mark_cash', async () => {
    const role = await Role.create({ ownerId: a.ownerId, name: 'Desk', permissions: ['booking.view', 'booking.create'] });
    const desk = await addMember(ctx.services, a.ownerId, { roleId: String(role._id) });
    const cash = await walkin(desk.token, { payment: { method: 'cash' } });
    expect(cash.status).toBe(403);
    expect(cash.body.error.code).toBe('forbidden');
    expect(await Booking.countDocuments({}).setOptions({ crossTenant: true })).toBe(0);
    expect((await walkin(desk.token)).status).toBe(201);
  });
});

describe('walk-in unpaid, then cash later', () => {
  it('walks through partial, remaining, already_paid and invalid amounts', async () => {
    const res = await walkin(staff.token);
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ paymentStatus: 'unpaid', amountPaid: 0 });
    const id = res.body.booking.id as string;

    const part = await post(`/bookings/${id}/payments/cash`, staff.token, { amount: 1000 });
    expect(part.status).toBe(201);
    expect(part.body.booking).toMatchObject({ paymentStatus: 'partially_paid', amountPaid: 1000 });
    expect(part.body.payment).toMatchObject({ method: 'cash', amount: 1000, status: 'succeeded' });

    for (const amount of [0, 2001]) {
      const bad = await post(`/bookings/${id}/payments/cash`, staff.token, { amount });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('invalid_amount');
    }

    const rest = await post(`/bookings/${id}/payments/cash`, staff.token);
    expect(rest.status).toBe(201);
    expect(rest.body.payment.amount).toBe(2000);
    expect(rest.body.booking).toMatchObject({ paymentStatus: 'paid', amountPaid: 3000 });

    const again = await post(`/bookings/${id}/payments/cash`, staff.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_paid');
    expect(await Payment.countDocuments({}).setOptions({ crossTenant: true })).toBe(2);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'payment.cash' })).toBe(2);
  });

  it('refuses cash on a rejected booking', async () => {
    const id = await pendingBooking();
    await post(`/bookings/${id}/reject`, a.token);
    const res = await post(`/bookings/${id}/payments/cash`, a.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
  });

  it('two concurrent full-balance payments: one wins', async () => {
    const id = (await walkin(staff.token)).body.booking.id as string;
    const rs = await Promise.all([1, 2].map(() => post(`/bookings/${id}/payments/cash`, a.token)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await Booking.findOne({ ownerId: a.ownerId, _id: id }))!.amountPaid).toBe(3000);
  });
});

describe('confirm and reject a pending guest booking', () => {
  it('confirms once, rejects another and frees its slot', async () => {
    const id = await pendingBooking();
    const ok = await post(`/bookings/${id}/confirm`, a.token);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.status).toBe('confirmed');
    const log = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'booking.confirmed' }).lean();
    expect(log).toMatchObject({ before: { status: 'pending' }, after: { status: 'confirmed' } });
    const again = await post(`/bookings/${id}/confirm`, a.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_transition');

    const other = await pendingBooking({ hm: '20:00' });
    expect((await gridSlot('20:00')).status).toBe('pending');
    const rej = await post(`/bookings/${other}/reject`, a.token, { reason: 'Double booked' });
    expect(rej.status).toBe(200);
    expect(rej.body.booking).toMatchObject({ status: 'rejected', rejectReason: 'Double booked' });
    expect(await SlotLock.countDocuments({ bookingId: other }).setOptions({ crossTenant: true })).toBe(0);
    expect((await gridSlot('20:00')).status).toBe('available');
    expect((await post(`/bookings/${other}/reject`, a.token)).status).toBe(409);
  });

  it('confirm is pending-only: an awaiting_payment hold is refused', async () => {
    const id = await pendingBooking();
    await Booking.updateOne({ ownerId: a.ownerId, _id: id }, { status: 'awaiting_payment', holdExpiresAt: new Date('2027-01-01') });
    const res = await post(`/bookings/${id}/confirm`, a.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
    expect((await Booking.findOne({ ownerId: a.ownerId, _id: id }))!.status).toBe('awaiting_payment');
  });

  it('rejects a too-long reason', async () => {
    const id = await pendingBooking();
    expect((await post(`/bookings/${id}/reject`, a.token, { reason: 'x'.repeat(301) })).status).toBe(400);
  });

  it('concurrent confirm and reject: one 200, one 409', async () => {
    const id = await pendingBooking();
    const rs = await Promise.all([post(`/bookings/${id}/confirm`, a.token), post(`/bookings/${id}/reject`, a.token)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = rs.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('invalid_transition');
    const final = (await Booking.findOne({ ownerId: a.ownerId, _id: id }))!.status;
    const locks = await SlotLock.countDocuments({ bookingId: id }).setOptions({ crossTenant: true });
    expect(locks).toBe(final === 'rejected' ? 0 : 1);
  });
});

describe('check-in and no-show', () => {
  it('enforces the time windows', async () => {
    const id = (await walkin(staff.token)).body.booking.id as string;
    await setClock('2026-01-10T10:00:00Z'); // 2 h before 12:00Z
    const early = await post(`/bookings/${id}/check-in`, staff.token);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('too_early');
    await setClock('2026-01-10T11:30:00Z');
    const ok = await post(`/bookings/${id}/check-in`, staff.token);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.status).toBe('completed');
    expect(ok.body.booking.completedAt).toBe(ctx.services.now().toISOString());
    expect((await gridSlot('18:00')).status).toBe('booked');

    const id2 = (await walkin(staff.token, { startAts: [at('20:00').toISOString()] })).body.booking.id as string;
    const tooEarly = await post(`/bookings/${id2}/no-show`, staff.token);
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('too_early');
    await setClock('2026-01-10T14:05:00Z'); // 20:00 Dhaka = 14:00Z
    const ns = await post(`/bookings/${id2}/no-show`, staff.token);
    expect(ns.status).toBe(200);
    expect(ns.body.booking.status).toBe('no_show');
  });

  it('check-in of a pending booking is invalid_transition', async () => {
    const id = await pendingBooking();
    await setClock('2026-01-10T12:00:00Z');
    const res = await post(`/bookings/${id}/check-in`, staff.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
  });
});

describe('permissions', () => {
  it('staff cannot confirm or reject; manager can; staff can check in, take cash and walk in', async () => {
    const id = await pendingBooking();
    expect((await post(`/bookings/${id}/confirm`, staff.token)).status).toBe(403);
    expect((await post(`/bookings/${id}/reject`, staff.token)).status).toBe(403);
    expect((await post(`/bookings/${id}/confirm`, manager.token)).status).toBe(200);
    await setClock('2026-01-10T12:00:00Z');
    expect((await post(`/bookings/${id}/check-in`, staff.token)).status).toBe(200);
    expect((await walkin(staff.token, { startAts: [at('21:00').toISOString()] })).status).toBe(201);
    const wid = (await Booking.findOne({ ownerId: a.ownerId, startAt: at('21:00') }))!.id as string;
    expect((await post(`/bookings/${wid}/payments/cash`, staff.token, { amount: 500 })).status).toBe(201);
  });
});

describe('list', () => {
  it('scopes to the member, filters, sorts, and bounds the range', async () => {
    const late = await pendingBooking({ hm: '20:00' });
    const early = await pendingBooking({ hm: '10:00' });
    const other = await pendingBooking({ venueId: v2, turfId: t2 });
    await post(`/bookings/${late}/confirm`, a.token);

    const mgr = await get(`/bookings?venueId=${v1}&from=${D}&to=${D}`, manager.token);
    expect(mgr.status).toBe(200);
    expect(mgr.body.bookings.map((b: { id: string }) => b.id)).toEqual([early, late]);

    const noVenue = await get(`/bookings?from=${D}&to=${D}`, manager.token);
    expect(noVenue.body.bookings.map((b: { id: string }) => b.id)).toEqual([early, late]);
    const all = await get(`/bookings?from=${D}&to=${D}`, a.token);
    expect(all.body.bookings).toHaveLength(3);
    expect(all.body.bookings.map((b: { id: string }) => b.id)).toContain(other);

    const pending = await get(`/bookings?from=${D}&to=${D}&status=pending`, a.token);
    expect(pending.body.bookings.map((b: { id: string }) => b.id).sort()).toEqual([early, other].sort());
    const turf = await get(`/bookings?from=${D}&to=${D}&turfId=${t2}`, a.token);
    expect(turf.body.bookings.map((b: { id: string }) => b.id)).toEqual([other]);

    expect((await get(`/bookings?venueId=${v2}&from=${D}&to=${D}`, manager.token)).status).toBe(404);
    expect((await get('/bookings?from=2026-01-01&to=2026-02-01', a.token)).status).toBe(400);
    expect((await get('/bookings?from=2026-01-01&to=2026-01-31', a.token)).status).toBe(200);
    expect((await get('/bookings', a.token)).status).toBe(400);
    expect((await get(`/bookings?venueId=${v1}`, a.token)).status).toBe(200);
  });

  it('defaults to today in the venue timezone', async () => {
    await setClock('2026-01-10T20:00:00Z'); // 02:00 on Jan 11 in Dhaka
    await pendingBooking({ hm: '10:00' });
    const res = await get(`/bookings?venueId=${v1}`, a.token);
    expect(res.body.bookings).toHaveLength(0);
    const day = await get(`/bookings?venueId=${v1}&from=${D}`, a.token);
    expect(day.status).toBe(200); // to defaults to Jan 11
    expect(day.body.bookings).toHaveLength(1);
  });

  it('pages a tab: all, today, upcoming or past, in the chosen order', async () => {
    await setClock('2026-01-10T06:00:00Z'); // noon on Jan 10 in Dhaka
    let n = 0;
    const on = async (date: string, ref: string) => {
      const id = await pendingBooking({ hm: `${String(8 + n++).padStart(2, '0')}:00` });
      const startAt = at('10:00', date);
      await Booking.updateOne({ _id: id, ownerId: a.ownerId }, { businessDate: date, startAt, endAt: new Date(startAt.getTime() + 3_600_000), reference: ref });
      return id;
    };
    const past = await on('2026-01-05', 'RC');
    const later = await on('2026-01-20', 'RA');
    const today = await on(D, 'RB');
    const soon = await on('2026-01-12', 'RD');
    const list = async (query: string) => {
      const res = await get(`/bookings?venueId=${v1}&${query}`, a.token);
      expect(res.status).toBe(200);
      return { ids: (res.body.bookings as { id: string }[]).map((b) => b.id), total: res.body.total as number };
    };

    expect(await list('scope=all')).toEqual({ ids: [soon, today, later, past], total: 4 }); // newest made first
    expect(await list('scope=all&sort=created-asc')).toEqual({ ids: [past, later, today, soon], total: 4 });
    expect((await list('scope=all&sort=ref-asc')).ids).toEqual([later, today, past, soon]);
    expect((await list('scope=all&sort=date-desc')).ids).toEqual([later, soon, today, past]);
    expect(await list('scope=today')).toEqual({ ids: [today], total: 1 });
    expect(await list('scope=upcoming')).toEqual({ ids: [soon, later], total: 2 });
    expect(await list('scope=past')).toEqual({ ids: [past], total: 1 });
    expect(await list('scope=upcoming&to=2026-01-15')).toEqual({ ids: [soon], total: 1 });
    expect(await list('scope=all&from=2026-01-10&to=2026-01-12&sort=date-asc')).toEqual({ ids: [today, soon], total: 2 });
    expect(await list('scope=all&sort=date-asc&page=2&pageSize=3')).toEqual({ ids: [later], total: 4 });
    expect(await list('scope=all&q=rd')).toEqual({ ids: [soon], total: 1 });

    expect((await get('/bookings?scope=today', a.token)).status).toBe(400);
    expect((await get('/bookings?scope=all', a.token)).status).toBe(200);
    expect((await get(`/bookings?venueId=${v1}&scope=soon`, a.token)).status).toBe(400);
    expect((await get(`/bookings?venueId=${v1}&scope=all&pageSize=101`, a.token)).status).toBe(400);
  });

  it('searches every date by reference, customer name, phone or player', async () => {
    const old = await pendingBooking({ hm: '09:00' });
    await Booking.updateOne({ _id: old, ownerId: a.ownerId }, { reference: 'RFIND01', businessDate: '2025-03-01', guest: { name: 'Rahim Uddin', phone: '+8801899999999' } });
    const player = await User.create({ name: 'Karim Player', phone: '+8801755555555', roles: ['player'] });
    const mine = await pendingBooking({ hm: '11:00' });
    await Booking.updateOne({ _id: mine, ownerId: a.ownerId }, { guest: null, playerId: player._id });
    const other = await pendingBooking({ venueId: v2, turfId: t2 });
    await Booking.updateOne({ _id: other, ownerId: a.ownerId }, { guest: { name: 'Rahim Other', phone: PHONE } });
    const ids = async (q: string, token = a.token, extra = '') =>
      ((await get(`/bookings?q=${encodeURIComponent(q)}${extra}`, token)).body.bookings as { id: string }[]).map((b) => b.id).sort();

    expect(await ids('rfind')).toEqual([old]);
    expect(await ids('rahim')).toEqual([old, other].sort());
    expect(await ids('rahim', a.token, `&venueId=${v1}`)).toEqual([old]);
    expect(await ids('rahim', manager.token)).toEqual([old]); // v2 is outside the manager's venues
    expect(await ids('1899 999')).toEqual([old]);
    expect(await ids('karim')).toEqual([mine]);
    expect(await ids('rahim', a.token, '&status=cancelled')).toEqual([]);
    expect((await get(`/bookings?q=${'x'.repeat(81)}`, a.token)).status).toBe(400);
  });
});

describe('tenancy', () => {
  it('404s identically for another owner, an out-of-scope venue and a malformed id', async () => {
    const b = await seedOwner(ctx.services, { name: 'Other' });
    const bv = (await seedVenue(b.ownerId, { timezone: TZ })).id as string;
    const bt = (await seedTurf(b.ownerId, bv)).id as string;
    const foreign = await pendingBooking({ ownerId: b.ownerId, venueId: bv, turfId: bt });
    const outOfScope = await pendingBooking({ venueId: v2, turfId: t2 });
    const calls = [
      (id: string) => get(`/bookings/${id}`, manager.token),
      (id: string) => post(`/bookings/${id}/confirm`, manager.token),
      (id: string) => post(`/bookings/${id}/check-in`, manager.token),
      (id: string) => post(`/bookings/${id}/payments/cash`, manager.token),
    ];
    for (const call of calls) {
      const bodies = [];
      for (const id of [foreign, outOfScope, 'not-an-id']) {
        const res = await call(id);
        expect(res.status).toBe(404);
        bodies.push(res.body);
      }
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
    }
    expect((await Booking.findOne({ _id: foreign }).setOptions({ crossTenant: true }))!.status).toBe('pending');
  });
});

describe('staff cancellation', () => {
  /** A confirmed walk-in at `venueId` with 3000 taken in cash. */
  async function paidWalkin(venueId = v1, turfId = t1) {
    const res = await walkin(a.token, { payment: { method: 'cash' } }, venueId, turfId);
    expect(res.status).toBe(201);
    return res.body.booking.id as string;
  }

  it('staff preview shows a 100% refund', async () => {
    const id = await paidWalkin();
    const res = await get(`/bookings/${id}/cancellation`, manager.token);
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({ percent: 100, amount: 3000, amountPaid: 3000, amountRefunded: 0, card: 0, cash: 3000 });
  });

  it('staff cancel needs booking.cancel', async () => {
    const id = await paidWalkin();
    const res = await post(`/bookings/${id}/cancel`, staff.token);
    expect(res.status).toBe(403);
    expect((await Booking.findById(id).setOptions({ crossTenant: true }))!.status).toBe('confirmed');
  });

  it('staff cancel returns the booking and its refunds', async () => {
    const id = await paidWalkin();
    const res = await post(`/bookings/${id}/cancel`, manager.token, { reason: '  rain  ' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id, status: 'cancelled', paymentStatus: 'refunded', amountRefunded: 3000, cancelledBy: 'staff', cancelReason: 'rain' });
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ method: 'cash', status: 'pending', amount: 3000, reason: 'cancellation', ruleApplied: { minHoursBefore: null, percent: 100 } });
    expect((await post(`/bookings/${id}/cancel`, manager.token, { nope: 1 })).status).toBe(400);
  });

  it('booking detail lists refunds', async () => {
    const id = await paidWalkin();
    expect((await get(`/bookings/${id}`, manager.token)).body.refunds).toEqual([]);
    const cancelled = await post(`/bookings/${id}/cancel`, manager.token);
    const res = await get(`/bookings/${id}`, manager.token);
    expect(res.body.refunds).toEqual(cancelled.body.refunds);
    expect(res.body.refunds).toHaveLength(1);
  });

  it('a manager limited to another venue gets 404', async () => {
    const id = await paidWalkin(v2, t2);
    expect((await get(`/bookings/${id}/cancellation`, manager.token)).status).toBe(404);
    expect((await post(`/bookings/${id}/cancel`, manager.token)).status).toBe(404);
    expect((await Booking.findById(id).setOptions({ crossTenant: true }))!.status).toBe('confirmed');
  });
});

describe('customer search', () => {
  it('finds past guests and players by name or phone, one entry each, within scope', async () => {
    expect((await walkin(staff.token, { customer: { name: 'Rahim Chowdhury', phone: PHONE } })).status).toBe(201);
    expect(
      (await walkin(staff.token, { startAts: [at('10:00').toISOString()], customer: { name: 'Rahim C', phone: PHONE } })).status,
    ).toBe(201);
    const player = await User.create({ name: 'Rahima Akter', email: 'ra@test.local', phone: '+8801722222222' });
    await Booking.create({
      ownerId: a.ownerId, venueId: v1, turfId: t1, reference: 'RPLAYER1', businessDate: D, startAt: at('12:00'),
      endAt: at('13:00'), slots: [{ startAt: at('12:00'), endAt: at('13:00'), price: 1500 }], addons: [], currency: 'BDT',
      subtotal: 1500, addonsTotal: 0, total: 1500, advanceRequired: 0, amountPaid: 0, status: 'confirmed',
      paymentStatus: 'unpaid', source: 'online', playerId: player._id, guest: null,
      policySnapshot: { paymentPolicy: { type: 'none' }, refundRules: [] },
    });
    expect(
      (await walkin(staff.token, { startAts: [at('20:00').toISOString()], customer: { name: 'Rahman Away', phone: '+8801733333333' } }, v2, t2)).status,
    ).toBe(201);
    await User.create({ name: 'Rahat Stranger', email: 'rs@test.local' });

    const byName = await get('/customers?q=rah', staff.token);
    expect(byName.status).toBe(200);
    expect(byName.body.customers).toEqual([
      { name: 'Rahman Away', phone: '+8801733333333', playerId: null },
      { name: 'Rahim Chowdhury', phone: PHONE, playerId: null },
      { name: 'Rahima Akter', phone: '+8801722222222', playerId: player.id },
    ]);

    const byPhone = await get('/customers?q=01722', staff.token);
    expect(byPhone.body.customers).toEqual([{ name: 'Rahima Akter', phone: '+8801722222222', playerId: player.id }]);

    const scoped = await get('/customers?q=rahman', manager.token);
    expect(scoped.body.customers).toEqual([]);

    expect((await get('/customers?q=r', staff.token)).status).toBe(400);
    expect((await get('/customers?q=(.*', staff.token)).body.customers).toEqual([]);
  });
});
