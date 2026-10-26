import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe, piCanceled, piSucceeded, postEvent } from '../helpers/stripe';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Addon.init(), AddonAssignment.init(), Booking.init(), SlotLock.init(), Payment.init(), Refund.init(),
    PaymentGatewayAccount.init(), WebhookEvent.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
const D = '2026-01-10';
const ALSO = ['2026-01-11', '2026-01-12'];
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string, date = D) => localToUtc(date, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let venueId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Addon, AddonAssignment, Booking, SlotLock, Payment, Refund, PaymentGatewayAccount, WebhookEvent].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
});

async function setup(settings: Record<string, unknown> = {}) {
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: { hours: HOURS, bookingWindowDays: 365, ...settings },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 1500, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  venueId = venue.id as string;
}

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

const base = () => `/api/v1/venues/${slug}/turfs/${turfId}`;
const post = (path: string, body: object, token?: string) => {
  const r = request(ctx.app).post(path);
  if (token) r.set(...bearer(token));
  return r.send(body);
};
const sameTime = (dates: string[], hm = '19:00') => dates.map((d) => ({ date: d, startAts: [at(hm, d)] }));
const groupBody = (over: Record<string, unknown> = {}) => ({ date: D, startAts: [at('19:00')], more: sameTime(ALSO), ...over });
const bookings = () => Booking.find({}).setOptions(cross).sort({ startAt: 1 });

describe('multi-day quote', () => {
  it('prices each item on its own and sums them', async () => {
    await setup();
    const res = await post(`${base()}/quote`, groupBody({ startAts: [at('19:00'), at('20:00')] }));
    expect(res.status).toBe(200);
    expect(res.body.items.map((d: { date: string }) => d.date)).toEqual([D, ...ALSO]);
    expect(res.body.items[2].quote.slots.map((s: { startAt: string }) => s.startAt)).toEqual([at('19:00', ALSO[1])]);
    expect(res.body).toMatchObject({ total: 6000, advanceRequired: 0, guestAllowed: false });
    expect(res.body.quote.total).toBe(3000);
  });

  it('takes any times: two runs on one day and another day at another time, in start order', async () => {
    await setup();
    const more = [
      { date: ALSO[1], startAts: [at('18:00', ALSO[1])] },
      { date: ALSO[0], startAts: [at('11:00', ALSO[0])] },
      { date: ALSO[0], startAts: [at('10:00', ALSO[0]), at('09:00', ALSO[0])] },
    ];
    const res = await post(`${base()}/quote`, groupBody({ more }));
    expect(res.status).toBe(200);
    const starts = res.body.items.map((d: { quote: { slots: { startAt: string }[] } }) => d.quote.slots.map((s) => s.startAt));
    expect(starts).toEqual([[at('19:00')], [at('09:00', ALSO[0]), at('10:00', ALSO[0])], [at('11:00', ALSO[0])], [at('18:00', ALSO[1])]]);
    expect(res.body.total).toBe(7500);
  });

  it('rejects a slot picked twice', async () => {
    await setup();
    for (const more of [[{ date: D, startAts: [at('19:00')] }], [...sameTime([ALSO[0]]), ...sameTime([ALSO[0]])]]) {
      const res = await post(`${base()}/quote`, groupBody({ more }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
  });
});

describe('multi-day booking', () => {
  it('books every day at once with a shared group and the same add-ons', async () => {
    await setup();
    const towel = await Addon.create({ ownerId: owner.ownerId, name: 'Towel', pricingType: 'per_booking', price: 50, currency: 'BDT' });
    await AddonAssignment.create({ ownerId: owner.ownerId, addonId: towel._id, venueId, turfId: null, enabled: true });
    const { userId, token } = await newPlayer();
    const res = await post(`${base()}/bookings`, groupBody({ addons: [{ addonId: towel.id }] }), token);
    expect(res.status).toBe(201);
    expect(res.body.bookings).toHaveLength(3);
    expect(res.body.booking.id).toBe(res.body.bookings[0].id);

    const rows = await bookings();
    expect(rows.map((b) => b.businessDate)).toEqual([D, ...ALSO]);
    expect(rows.map((b) => b.startAt.toISOString())).toEqual([at('19:00'), at('19:00', ALSO[0]), at('19:00', ALSO[1])]);
    expect(new Set(rows.map((b) => String(b.groupId))).size).toBe(1);
    expect(rows[0]!.groupId).not.toBeNull();
    expect(new Set(rows.map((b) => b.reference)).size).toBe(3);
    for (const b of rows) {
      expect(b).toMatchObject({ status: 'confirmed', total: 1550, addonsTotal: 50 });
      expect(String(b.playerId)).toBe(userId);
    }
    expect(await SlotLock.countDocuments({}).setOptions(cross)).toBe(3);
  });

  it('books different times on different days, and two runs on one day', async () => {
    await setup();
    const { token } = await newPlayer();
    const more = [
      { date: ALSO[0], startAts: [at('09:00', ALSO[0])] },
      { date: ALSO[0], startAts: [at('11:00', ALSO[0]), at('12:00', ALSO[0])] },
      { date: ALSO[1], startAts: [at('18:00', ALSO[1])] },
    ];
    const res = await post(`${base()}/bookings`, groupBody({ more }), token);
    expect(res.status).toBe(201);
    const rows = await bookings();
    expect(rows.map((b) => [b.businessDate, b.startAt.toISOString(), b.endAt.toISOString()])).toEqual([
      [D, at('19:00'), at('20:00')],
      [ALSO[0], at('09:00', ALSO[0]), at('10:00', ALSO[0])],
      [ALSO[0], at('11:00', ALSO[0]), at('13:00', ALSO[0])],
      [ALSO[1], at('18:00', ALSO[1]), at('19:00', ALSO[1])],
    ]);
    expect(new Set(rows.map((b) => String(b.groupId))).size).toBe(1);
  });

  it('lists the other days on each booking of the group, and only for its player', async () => {
    await setup();
    const { token } = await newPlayer();
    const made = await post(`${base()}/bookings`, groupBody(), token);
    const ids: string[] = made.body.bookings.map((b: { id: string }) => b.id);
    const res = await request(ctx.app).get(`/api/v1/me/bookings/${ids[1]}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.group.map((b: { id: string }) => b.id)).toEqual([ids[0], ids[2]]);
    expect(res.body.group.map((b: { businessDate: string }) => b.businessDate)).toEqual([D, ALSO[1]]);

    const single = await post(`${base()}/bookings`, { date: ALSO[1], startAts: [at('21:00', ALSO[1])] }, token);
    const alone = await request(ctx.app).get(`/api/v1/me/bookings/${single.body.booking.id}`).set('Authorization', `Bearer ${token}`);
    expect(alone.body.group).toEqual([]);
  });

  it('books nothing when one day is taken, and names that day', async () => {
    await setup();
    const other = await newPlayer();
    expect((await post(`${base()}/bookings`, { date: ALSO[1], startAts: [at('19:00', ALSO[1])] }, other.token)).status).toBe(201);
    const { token } = await newPlayer();
    const res = await post(`${base()}/bookings`, groupBody(), token);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'slot_taken', details: { date: ALSO[1], itemStart: at('19:00', ALSO[1]) } });
    expect(await Booking.countDocuments({}).setOptions(cross)).toBe(1);
  });

  it('names a day outside the booking window', async () => {
    await setup();
    const { token } = await newPlayer();
    const far = '2027-12-01';
    const res = await post(`${base()}/bookings`, groupBody({ more: sameTime([ALSO[0], far]) }), token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'outside_window', details: { date: far } });
    expect(await Booking.countDocuments({}).setOptions(cross)).toBe(0);
  });

  it('needs a signed-in player', async () => {
    await setup();
    const res = await post(`${base()}/bookings`, groupBody({ guest: { name: 'Guest', phone: '+8801711111111', otpCode: '123456' } }));
    expect(res.status).toBe(401);
    expect(await Booking.countDocuments({}).setOptions(cross)).toBe(0);
  });
});

describe('multi-day payment', () => {
  let player: { userId: string; token: string };
  let secret: string;

  beforeEach(async () => {
    await setup({ paymentPolicy: { type: 'partial_percent', percent: 20 } });
    ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
    player = await newPlayer();
  });

  /** Three held days with a 300 advance each, and the one intent paying for them. */
  async function heldGroup() {
    const res = await post(`${base()}/bookings`, groupBody(), player.token);
    expect(res.status).toBe(201);
    expect(res.body.bookings.map((b: { status: string }) => b.status)).toEqual(['awaiting_payment', 'awaiting_payment', 'awaiting_payment']);
    // Any day of the group starts the payment for all of them.
    const pay = await post(`/api/v1/bookings/${res.body.bookings[1].id}/payment`, {}, player.token);
    expect(pay.status).toBe(200);
    expect(pay.body.payment.amount).toBe(900);
    const rows = await Payment.find({ ownerId: owner.ownerId, status: 'pending' }).sort({ _id: 1 });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((p) => p.gatewayRef)).size).toBe(1);
    const lead = rows.find((p) => String(p._id) === pay.body.payment.id)!;
    expect(String(lead.bookingId)).toBe(res.body.bookings[0].id);
    return { lead, rows };
  }

  it('starts the same intent again on a second call', async () => {
    const { lead } = await heldGroup();
    const again = await post(`/api/v1/bookings/${String(lead.bookingId)}/payment`, {}, player.token);
    expect(again.body.payment).toMatchObject({ id: String(lead._id), amount: 900 });
    expect(await Payment.countDocuments({ ownerId: owner.ownerId })).toBe(3);
  });

  it('confirms every day on one succeeded intent', async () => {
    const { lead } = await heldGroup();
    const res = await postEvent(ctx.app, owner.ownerId, secret, piSucceeded({ ...lead.toObject(), amount: 900 }));
    expect(res.status).toBe(200);
    for (const b of await bookings()) expect(b).toMatchObject({ status: 'confirmed', amountPaid: 300, paymentStatus: 'partially_paid' });
    const paid = await Payment.find({ ownerId: owner.ownerId });
    expect(paid.map((p) => p.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  });

  it('refunds a day that was lost while the others confirm', async () => {
    const { lead } = await heldGroup();
    ctx.services.clock.advance(11 * 60_000);
    const thief = await newPlayer();
    const taken = await post(`${base()}/bookings`, { date: ALSO[0], startAts: [at('19:00', ALSO[0])] }, thief.token);
    expect(taken.status).toBe(201);
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded({ ...lead.toObject(), amount: 900 }))).status).toBe(200);
    const mine = (await bookings()).filter((b) => String(b.playerId) === player.userId);
    expect(mine.map((b) => b.status)).toEqual(['confirmed', 'expired', 'confirmed']);
    const refunds = await Refund.find({ ownerId: owner.ownerId });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 300, reason: 'late_payment' });
    expect(String(refunds[0]!.bookingId)).toBe(String(mine[1]!._id));
  });

  it('fails every day on a wrong amount and refunds what was taken', async () => {
    const { lead } = await heldGroup();
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded({ ...lead.toObject(), amount: 300 }))).status).toBe(200);
    const rows = await Payment.find({ ownerId: owner.ownerId });
    expect(rows.map((p) => p.status)).toEqual(['failed', 'failed', 'failed']);
    const refunds = await Refund.find({ ownerId: owner.ownerId });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 300, reason: 'amount_mismatch' });
    for (const b of await bookings()) expect(b.status).toBe('awaiting_payment');
  });

  it('closes every day when the intent is cancelled', async () => {
    const { lead } = await heldGroup();
    expect((await postEvent(ctx.app, owner.ownerId, secret, piCanceled(lead))).status).toBe(200);
    expect((await Payment.find({ ownerId: owner.ownerId })).map((p) => p.status)).toEqual(['failed', 'failed', 'failed']);
  });
});
