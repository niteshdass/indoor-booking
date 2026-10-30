import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MANUAL_HOLD_MINUTES, hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { addMember, seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { Refund } from '../../src/payments/refund.model';
import { Notification } from '../../src/notifications/notification.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { expireHolds } from '../../src/jobs/sweeps';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), Refund.init(), Notification.init(), PaymentGatewayAccount.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z, so this is the next day.
const D = '2026-01-02';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const MIN = 60_000;
const BKASH = { provider: 'bkash', number: '+8801712345678', accountType: 'personal' };
const SUBMIT = { provider: 'bkash', trxId: '9A1B2C3D4E', senderNumber: '01812345678' };
/** A 300000 game at 20% holds for this advance. */
const ADVANCE = 60000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;

async function newPlayer() {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local`, emailVerified: true });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}
type Player = Awaited<ReturnType<typeof newPlayer>>;
const resign = async (p: Player) => ({ ...p, token: await signAccessToken(p.userId, ctx.config.jwtSecret, ctx.services.now()) });

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, Refund, Notification, PaymentGatewayAccount].map(
      (m) => (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, {
    published: true,
    slug: `arena-${Math.random().toString(36).slice(2, 8)}`,
    timezone: TZ,
    settings: {
      hours: HOURS,
      bookingWindowDays: 365,
      paymentPolicy: { type: 'partial_percent', percent: 20 },
      paymentMethods: { manualWallets: [BKASH], gateways: [] },
    },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 300000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
});

async function book(player: Player, hm = '18:00', more: object[] = []) {
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at(hm)], more });
  expect(res.status).toBe(201);
  return res.body as { booking: { id: string }; bookings?: { id: string }[] };
}

const submit = (player: Player, bookingId: string, body: object = SUBMIT) =>
  request(ctx.app).post(`/api/v1/bookings/${bookingId}/payments/manual`).set(...bearer(player.token)).send(body);

/** A booking with a submitted payment waiting to be checked. */
async function submitted(hm = '18:00') {
  const player = await newPlayer();
  const { booking } = await book(player, hm);
  const res = await submit(player, booking.id);
  expect(res.status).toBe(201);
  expect(res.body.outcome).toBe('pending');
  return { player, bookingId: booking.id };
}

/** The owner's token, signed now: a test may move the clock past a hold. */
const ownerToken = () => signAccessToken(owner.userId, ctx.config.jwtSecret, ctx.services.now());
const ownerPost = async (path: string, token?: string, body: object = {}) =>
  request(ctx.app).post(`/api/v1/owners/${owner.ownerId}${path}`).set(...bearer(token ?? (await ownerToken()))).send(body);
const verify = (bookingId: string, body: object = {}, token?: string) =>
  ownerPost(`/bookings/${bookingId}/payments/manual/verify`, token, body);
const reject = (bookingId: string, token?: string) => ownerPost(`/bookings/${bookingId}/payments/manual/reject`, token);

const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const paymentsOf = (bookingId: string) => Payment.find({ bookingId }).setOptions(cross).sort({ _id: 1 });
const refundsOf = (bookingId: string) => Refund.find({ bookingId }).setOptions(cross).sort({ _id: 1 });
const noticesOf = (bookingId: string, event: string) => Notification.countDocuments({ bookingId, event }).setOptions(cross);

describe('POST /bookings/:id/payments/manual/verify', () => {
  it('verify confirms the booking and counts the payment', async () => {
    const { bookingId } = await submitted();
    const res = await verify(bookingId);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id: bookingId, status: 'confirmed', amountPaid: ADVANCE, paymentStatus: 'partially_paid' });
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE });
    const [p] = await paymentsOf(bookingId);
    expect(p).toMatchObject({ status: 'succeeded', amount: ADVANCE, excess: false });
    expect(String(p!.verifiedBy)).toBe(owner.userId);
    expect(p!.verifiedAt?.toISOString()).toBe(ctx.services.now().toISOString());
    expect(await noticesOf(bookingId, 'payment_received')).toBe(1);
    expect(await refundsOf(bookingId)).toHaveLength(0);
    const logs = await ActivityLog.find({ ownerId: owner.ownerId, action: 'payment.verified' }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.after).toEqual({ trxId: '9A1B2C3D4E', provider: 'bkash', amountDue: ADVANCE, amountReceived: ADVANCE });
    expect(JSON.stringify(logs)).not.toContain('8801812345678');
  });

  it('verify with less received leaves the rest due', async () => {
    const { bookingId } = await submitted();
    const res = await verify(bookingId, { amountReceived: ADVANCE - 10000 });
    expect(res.status).toBe(200);
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE - 10000 });
    expect((await paymentsOf(bookingId))[0]).toMatchObject({ status: 'succeeded', amount: ADVANCE - 10000 });
    expect(await refundsOf(bookingId)).toHaveLength(0);
  });

  it('verify with more received creates a wallet refund to send', async () => {
    const { bookingId } = await submitted();
    const res = await verify(bookingId, { amountReceived: ADVANCE + 5000 });
    expect(res.status).toBe(200);
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE });
    const [p] = await paymentsOf(bookingId);
    expect(p).toMatchObject({ status: 'succeeded', amount: ADVANCE + 5000, refundedAmount: 5000, excess: false });
    const refunds = await refundsOf(bookingId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      method: 'wallet',
      status: 'pending',
      reason: 'overpayment',
      amount: 5000,
      gateway: null,
      trxId: null,
      currency: 'BDT',
    });
    expect(String(refunds[0]!.paymentId)).toBe(String(p!._id));
  });

  it('rejects a bad amountReceived', async () => {
    const { bookingId } = await submitted();
    for (const amountReceived of [0, -5, 1.5, '100']) {
      const res = await verify(bookingId, { amountReceived });
      expect(res.status).toBe(400);
    }
    expect((await bookingOf(bookingId)).status).toBe('pending');
  });

  it('verify a group confirms every booking', async () => {
    const player = await newPlayer();
    const body = await book(player, '18:00', [{ date: D, startAts: [at('20:00')] }]);
    const ids = body.bookings!.map((b) => b.id);
    expect((await submit(player, ids[1]!)).status).toBe(201);

    // Verified from the second booking; the received amount covers the first in full and half the second.
    const res = await verify(ids[1]!, { amountReceived: ADVANCE + ADVANCE / 2 });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id: ids[1], status: 'confirmed' });
    expect(await bookingOf(ids[0]!)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE });
    expect(await bookingOf(ids[1]!)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE / 2 });
    const rows = await Payment.find({ kind: 'manual' }).setOptions(cross).sort({ _id: 1 });
    expect(rows.map((p) => [p.status, p.amount])).toEqual([
      ['succeeded', ADVANCE],
      ['succeeded', ADVANCE / 2],
    ]);
    for (const id of ids) expect(await noticesOf(id, 'payment_received')).toBe(1);
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'payment.verified' })).toBe(1);
  });

  it('verify a group with more received refunds the excess once on the lead booking', async () => {
    const player = await newPlayer();
    const body = await book(player, '18:00', [{ date: D, startAts: [at('20:00')] }]);
    const ids = body.bookings!.map((b) => b.id);
    expect((await submit(player, ids[0]!)).status).toBe(201);
    expect((await verify(ids[0]!, { amountReceived: 2 * ADVANCE + 700 })).status).toBe(200);
    for (const id of ids) expect(await bookingOf(id)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE });
    const refunds = await Refund.find({}).setOptions(cross);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ reason: 'overpayment', amount: 700, method: 'wallet' });
    expect(String(refunds[0]!.bookingId)).toBe(ids[0]);
  });

  it('verify a late payment whose slots were taken refunds it in full', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    ctx.services.clock.advance((MANUAL_HOLD_MINUTES + 1) * MIN);
    await expireHolds(ctx.services.now());
    await book(await newPlayer());
    const late = await submit(await resign(player), booking.id);
    expect(late.body.outcome).toBe('slots_taken');

    const res = await verify(booking.id);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('expired');
    expect(await bookingOf(booking.id)).toMatchObject({ status: 'expired', amountPaid: 0 });
    const [p] = await paymentsOf(booking.id);
    expect(p).toMatchObject({ status: 'succeeded', excess: true, amount: ADVANCE, refundedAmount: ADVANCE });
    const refunds = await refundsOf(booking.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ method: 'wallet', status: 'pending', reason: 'late_payment', amount: ADVANCE });
    expect(await noticesOf(booking.id, 'payment_received')).toBe(0);
  });

  it('two verifies at once: one wins', async () => {
    const { bookingId } = await submitted();
    const results = await Promise.allSettled([verify(bookingId), verify(bookingId)]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 409]);
    const lost = results.find((r) => r.status === 'fulfilled' && r.value.status === 409);
    expect(lost?.status === 'fulfilled' && lost.value.body.error.code).toBe('invalid_transition');
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'confirmed', amountPaid: ADVANCE });
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'payment.verified' })).toBe(1);
  });

  it('verify without a pending manual payment is 409', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const res = await verify(booking.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
  });

  it('staff role without payment.verify gets 403', async () => {
    const { bookingId } = await submitted();
    const staff = await addMember(ctx.services, owner.ownerId);
    expect((await verify(bookingId, {}, staff.token)).status).toBe(403);
    expect((await reject(bookingId, staff.token)).status).toBe(403);
    expect((await bookingOf(bookingId)).status).toBe('pending');
  });

  it('verify is tenant-scoped', async () => {
    const { bookingId } = await submitted();
    const other = await seedOwner(ctx.services, { name: 'Other' });
    const res = await request(ctx.app)
      .post(`/api/v1/owners/${other.ownerId}/bookings/${bookingId}/payments/manual/verify`)
      .set(...bearer(other.token))
      .send({});
    expect(res.status).toBe(404);
    expect((await bookingOf(bookingId)).status).toBe('pending');
  });
});

describe('POST /bookings/:id/payments/manual/reject', () => {
  it('reject frees the slots and tells the player', async () => {
    const { bookingId } = await submitted();
    const res = await reject(bookingId);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id: bookingId, status: 'rejected' });
    expect(await bookingOf(bookingId)).toMatchObject({ status: 'rejected', rejectReason: 'payment_not_received', amountPaid: 0 });
    expect(await SlotLock.countDocuments({ bookingId }).setOptions(cross)).toBe(0);
    expect((await paymentsOf(bookingId))[0]).toMatchObject({ status: 'failed', failureCode: 'not_received' });
    expect(await noticesOf(bookingId, 'payment_not_found')).toBe(1);
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'payment.not_received' })).toBe(1);
    // A second reject finds nothing to check.
    expect((await reject(bookingId)).status).toBe(409);
  });
});

describe('existing confirm and reject', () => {
  it('confirm on a booking with a pending manual payment is 409 payment_to_verify', async () => {
    const { bookingId } = await submitted();
    const confirm = await ownerPost(`/bookings/${bookingId}/confirm`);
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('payment_to_verify');
    const rej = await ownerPost(`/bookings/${bookingId}/reject`);
    expect(rej.status).toBe(409);
    expect(rej.body.error.code).toBe('payment_to_verify');
    expect((await bookingOf(bookingId)).status).toBe('pending');
  });
});

describe('owner booking JSON', () => {
  it('owner booking list includes manualPayment with the sender number', async () => {
    const { bookingId } = await submitted();
    const list = await request(ctx.app)
      .get(`/api/v1/owners/${owner.ownerId}/bookings`)
      .query({ from: D, to: D })
      .set(...bearer(owner.token));
    expect(list.status).toBe(200);
    const row = list.body.bookings.find((b: { id: string }) => b.id === bookingId);
    const [p] = await paymentsOf(bookingId);
    expect(row.manualPayment).toEqual({
      id: String(p!._id),
      provider: 'bkash',
      trxId: '9A1B2C3D4E',
      amount: ADVANCE,
      senderNumber: '+8801812345678',
      status: 'pending',
      submittedAt: ctx.services.now().toISOString(),
    });

    const detail = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${bookingId}`).set(...bearer(owner.token));
    expect(detail.body.booking.manualPayment).toMatchObject({ trxId: '9A1B2C3D4E' });
    expect(detail.body.payments[0]).toMatchObject({ method: 'wallet', kind: 'manual', provider: 'bkash', trxId: '9A1B2C3D4E' });
  });

  it('group members show the whole amount the lead row asks for', async () => {
    const player = await newPlayer();
    const body = await book(player, '18:00', [{ date: D, startAts: [at('20:00')] }]);
    const ids = body.bookings!.map((b) => b.id);
    expect((await submit(player, ids[0]!)).status).toBe(201);
    const group = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${ids[1]}`).set(...bearer(owner.token));
    expect(group.body.booking.manualPayment).toMatchObject({ trxId: '9A1B2C3D4E', amount: 2 * ADVANCE });
  });

  it('is null without a manual payment', async () => {
    const player = await newPlayer();
    const { booking } = await book(player);
    const detail = await request(ctx.app).get(`/api/v1/owners/${owner.ownerId}/bookings/${booking.id}`).set(...bearer(owner.token));
    expect(detail.body.booking.manualPayment).toBeNull();
  });
});
