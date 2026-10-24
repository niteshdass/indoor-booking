import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { hmToMin, localToUtc } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { signAccessToken } from '../../src/auth/jwt';
import { seedOwner, bearer } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe, piSucceeded, postEvent } from '../helpers/stripe';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import type { TenantContext } from '../../src/tenancy/context';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking } from '../../src/bookings/booking.model';
import { SlotLock } from '../../src/bookings/slotLock.model';
import { Payment } from '../../src/bookings/payment.model';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { WebhookEvent } from '../../src/payments/webhookEvent.model';
import { Refund } from '../../src/payments/refund.model';
import { AppError } from '../../src/errors';
import { cancelBooking, previewCancellation, type Canceller } from '../../src/bookings/cancel';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Booking.init(), SlotLock.init(), Payment.init(), PaymentGatewayAccount.init(), WebhookEvent.init(), Refund.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const TZ = 'Asia/Dhaka';
// The clock starts 2026-01-01T00:00Z; 18:00 Dhaka on the 5th is 108 hours later.
const D = '2026-01-05';
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '23:00' }]),
);
const at = (hm: string) => localToUtc(D, hmToMin(hm), TZ).toISOString();
const cross = { crossTenant: true };
const HOUR = 3_600_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let slug: string;
let turfId: string;
let secret: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, SlotLock, Payment, PaymentGatewayAccount, WebhookEvent, Refund].map(
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
      paymentPolicy: { type: 'partial_percent', percent: 60 },
      refundRules: [{ minHoursBefore: 96, percent: 100 }, { minHoursBefore: 72, percent: 40 }],
    },
  });
  const turf = await seedTurf(owner.ownerId, venue.id as string, { pricing: { base: 5000, rules: [] } });
  slug = venue.slug;
  turfId = turf.id as string;
  ({ webhookSecret: secret } = await connectStripe(ctx.app, owner));
});

type Player = { userId: string; token: string };
async function newPlayer(): Promise<Player> {
  const u = await User.create({ name: 'Player', email: `p${Math.random()}@test.local` });
  return { userId: u.id as string, token: await signAccessToken(u.id as string, ctx.config.jwtSecret, ctx.services.now()) };
}

/** A 5000 booking with its 3000 advance as a pending card intent (awaiting_payment). */
async function hold(hm = '18:00') {
  const player = await newPlayer();
  const res = await request(ctx.app)
    .post(`/api/v1/venues/${slug}/turfs/${turfId}/bookings`)
    .set(...bearer(player.token))
    .send({ date: D, startAts: [at(hm)] });
  expect(res.status).toBe(201);
  const bookingId = res.body.booking.id as string;
  const pay = await request(ctx.app).post(`/api/v1/bookings/${bookingId}/payment`).set(...bearer(player.token)).send({});
  expect(pay.status).toBe(200);
  const payment = (await Payment.findById(pay.body.payment.id).setOptions(cross))!;
  return { player, bookingId, payment };
}

/** A confirmed booking with 3000 paid by card (webhook), plus `cash` taken by staff. */
async function paid(cash = 0) {
  const h = await hold();
  expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(h.payment))).status).toBe(200);
  if (cash) {
    const res = await request(ctx.app)
      .post(`/api/v1/owners/${owner.ownerId}/bookings/${h.bookingId}/payments/cash`)
      .set(...bearer(owner.token))
      .send({ amount: cash });
    expect(res.status).toBe(201);
  }
  return h;
}

const bookingOf = async (id: string) => (await Booking.findById(id).setOptions(cross))!;
const locksOf = (bookingId: string) => SlotLock.countDocuments({ ownerId: owner.ownerId, bookingId });
const refundRows = () => Refund.find({ ownerId: owner.ownerId }).sort({ method: 1 }).lean();
const deps = () => ({ config: ctx.config, services: ctx.services });
const staff = (): Canceller => ({
  kind: 'staff',
  t: { ownerId: owner.ownerId, userId: owner.userId } as unknown as TenantContext,
});
const playerBy = (p: Player): Canceller => ({ kind: 'player', ownerId: owner.ownerId, userId: p.userId });
const codeOf = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  return { status: (err as AppError).status, code: (err as AppError).code };
};

describe('cancelBooking', () => {
  it('player cancel 80h before refunds 40% of what was paid, by card', async () => {
    const { player, bookingId } = await paid();
    ctx.services.clock.advance(28 * HOUR);
    const before = await bookingOf(bookingId);
    const preview = await previewCancellation(before, 'player', ctx.services.now());
    expect(preview).toMatchObject({ percent: 40, amount: 1200, rule: { minHoursBefore: 72, percent: 40 }, amountPaid: 3000, amountRefunded: 0, card: 1200, cash: 0 });

    const out = await cancelBooking(before, playerBy(player), { reason: 'plans changed' }, deps());
    expect(out.booking).toMatchObject({ status: 'cancelled', paymentStatus: 'partially_refunded', amountRefunded: 1200, cancelledBy: 'player', cancelReason: 'plans changed' });
    expect(out.booking.cancelledAt).toEqual(ctx.services.now());
    expect(await locksOf(bookingId)).toBe(0);
    const rows = await refundRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'succeeded', reason: 'cancellation', method: 'card', amount: preview.amount, ruleApplied: { minHoursBefore: 72, percent: 40 } });
    expect(out.refunds.map((r) => r.status)).toEqual(['succeeded']);
    const log = await ActivityLog.findOne({ ownerId: owner.ownerId, action: 'booking.cancelled' }).lean();
    expect(String(log!.actorId)).toBe(player.userId);
    expect(log!.after).toMatchObject({ status: 'cancelled', refund: { amount: 1200, percent: 40 } });
  });

  it('player cancel inside the last rule refunds nothing', async () => {
    const { player, bookingId } = await paid(2000);
    ctx.services.clock.advance(50 * HOUR);
    const out = await cancelBooking(await bookingOf(bookingId), playerBy(player), {}, deps());
    expect(out.booking).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', amountRefunded: 0 });
    expect(out.refunds).toHaveLength(0);
    expect(await refundRows()).toHaveLength(0);
    expect(await locksOf(bookingId)).toBe(0);
  });

  it('staff cancel refunds 100% split across card and cash', async () => {
    const { bookingId } = await paid(2000);
    ctx.services.clock.advance(50 * HOUR);
    const before = await bookingOf(bookingId);
    expect(await previewCancellation(before, 'staff', ctx.services.now())).toMatchObject({ percent: 100, amount: 5000, card: 3000, cash: 2000 });
    const out = await cancelBooking(before, staff(), {}, deps());
    expect(out.booking).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', amountRefunded: 5000, cancelledBy: 'staff' });
    const rows = await refundRows();
    expect(rows.map((r) => [r.method, r.status, r.amount])).toEqual([['card', 'succeeded', 3000], ['cash', 'pending', 2000]]);
    for (const r of rows) {
      expect(String(r.by)).toBe(owner.userId);
      expect(r.ruleApplied).toEqual({ minHoursBefore: null, percent: 100 });
    }
  });

  it('a refunded duplicate payment is not offered to the cancel, and its failed refund can still be recorded as cash', async () => {
    const { payment: a, bookingId } = await paid();
    const b = await Payment.create({
      ownerId: owner.ownerId, venueId: a.venueId, bookingId, method: 'card', kind: 'intent', amount: 3000, currency: 'BDT',
      status: 'pending', gateway: 'stripe', gatewayAccountId: a.gatewayAccountId, gatewayRef: 'pi_dup_1',
    });
    ctx.services.stripe.refundStatus = 'failed';
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(b))).status).toBe(200);
    ctx.services.stripe.refundStatus = 'succeeded';
    const dup = (await Refund.findOne({ ownerId: owner.ownerId, paymentId: b._id }).lean())!;
    expect(dup).toMatchObject({ reason: 'duplicate_payment', status: 'failed' });
    expect(await bookingOf(bookingId)).toMatchObject({ amountPaid: 3000 });

    const before = await bookingOf(bookingId);
    expect(await previewCancellation(before, 'staff', ctx.services.now())).toMatchObject({ amount: 3000, card: 3000 });
    const out = await cancelBooking(before, staff(), {}, deps());
    expect(out.refunds.map((r) => [String(r.paymentId), r.amount, r.status])).toEqual([[String(a._id), 3000, 'succeeded']]);

    const res = await request(ctx.app)
      .post(`/api/v1/owners/${owner.ownerId}/refunds/${String(dup._id)}/record-cash`)
      .set(...bearer(owner.token))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.refund).toMatchObject({ method: 'cash', status: 'succeeded', amount: 3000, paymentId: String(b._id) });
  });

  it('staff cancel inside a tier still records no rule, at 100%', async () => {
    const { bookingId } = await paid();
    ctx.services.clock.advance(28 * HOUR);
    await cancelBooking(await bookingOf(bookingId), staff(), {}, deps());
    const rows = await refundRows();
    expect(rows.map((r) => r.amount)).toEqual([3000]);
    expect(rows[0]!.ruleApplied).toEqual({ minHoursBefore: null, percent: 100 });
  });

  it('player cannot cancel after start; staff can', async () => {
    const { player, bookingId } = await paid();
    ctx.services.clock.advance(109 * HOUR);
    const b = await bookingOf(bookingId);
    expect(await codeOf(cancelBooking(b, playerBy(player), {}, deps()))).toEqual({ status: 409, code: 'too_late' });
    expect(await codeOf(previewCancellation(b, 'player', ctx.services.now()))).toEqual({ status: 409, code: 'too_late' });
    expect((await bookingOf(bookingId)).status).toBe('confirmed');
    const out = await cancelBooking(b, staff(), {}, deps());
    expect(out.booking.status).toBe('cancelled');
    expect(out.booking.amountRefunded).toBe(3000);
  });

  it('cancelling a hold cancels its payment intent first', async () => {
    const { player, bookingId, payment } = await hold();
    const out = await cancelBooking(await bookingOf(bookingId), playerBy(player), {}, deps());
    expect(ctx.services.stripe.calls.some((c) => c.method === 'paymentIntents.cancel')).toBe(true);
    expect(await Payment.findById(payment._id).setOptions(cross)).toMatchObject({ status: 'failed', failureCode: 'booking_cancelled' });
    expect(out.booking.status).toBe('cancelled');
    expect(out.refunds).toHaveLength(0);
    expect(await refundRows()).toHaveLength(0);
    expect(await locksOf(bookingId)).toBe(0);
  });

  it('a hold whose payment already went through cannot be cancelled', async () => {
    const { player, bookingId, payment } = await hold();
    ctx.services.stripe.settle(payment.gatewayRef!, 'succeeded');
    expect(await codeOf(cancelBooking(await bookingOf(bookingId), playerBy(player), {}, deps()))).toEqual({ status: 409, code: 'payment_in_progress' });
    expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');
    expect((await Payment.findById(payment._id).setOptions(cross))!.status).toBe('pending');

    // The payment then lands through its webhook and confirms the booking.
    expect((await postEvent(ctx.app, owner.ownerId, secret, piSucceeded(payment))).status).toBe(200);
    expect((await bookingOf(bookingId)).status).toBe('confirmed');
  });

  it('a hold whose gateway is gone cannot be cancelled', async () => {
    const { player, bookingId } = await hold();
    await PaymentGatewayAccount.deleteMany({}).setOptions(cross);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await codeOf(cancelBooking(await bookingOf(bookingId), playerBy(player), {}, deps()))).toEqual({ status: 409, code: 'payment_in_progress' });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('could not close payment'));
    } finally {
      spy.mockRestore();
    }
    expect((await bookingOf(bookingId)).status).toBe('awaiting_payment');
  });

  it('a failed refund dispatch does not fail the cancel', async () => {
    const { player, bookingId } = await paid();
    ctx.services.stripe.onRefundCreate = async () => {
      throw new Error('boom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await cancelBooking(await bookingOf(bookingId), playerBy(player), {}, deps());
      expect(out.booking.status).toBe('cancelled');
      expect(out.refunds.map((r) => [r.method, r.status])).toEqual([['card', 'pending']]);
    } finally {
      spy.mockRestore();
    }
    expect((await refundRows())[0]!.status).toBe('pending');
  });

  it('two concurrent cancels create refunds once', async () => {
    const { player, bookingId } = await paid();
    const b = await bookingOf(bookingId);
    const results = await Promise.allSettled([
      cancelBooking(b, playerBy(player), {}, deps()),
      cancelBooking(b, staff(), {}, deps()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(AppError);
    expect(lost.reason).toMatchObject({ status: 409, code: 'invalid_transition' });
    expect(await refundRows()).toHaveLength(1);
    expect((await bookingOf(bookingId)).amountRefunded).toBe(3000);
  });

  it('a cash payment committed before the cancel is refunded too', async () => {
    const { bookingId } = await paid();
    const stale = await bookingOf(bookingId);
    const res = await request(ctx.app)
      .post(`/api/v1/owners/${owner.ownerId}/bookings/${bookingId}/payments/cash`)
      .set(...bearer(owner.token))
      .send({ amount: 2000 });
    expect(res.status).toBe(201);
    const out = await cancelBooking(stale, staff(), {}, deps());
    expect(out.booking).toMatchObject({ paymentStatus: 'refunded', amountRefunded: 5000 });
    expect((await refundRows()).map((r) => [r.method, r.amount])).toEqual([['card', 3000], ['cash', 2000]]);
  });

  it('completed, expired and cancelled bookings cannot be cancelled', async () => {
    const { player, bookingId } = await paid();
    for (const status of ['completed', 'expired', 'cancelled']) {
      await Booking.updateOne({ _id: bookingId }, { $set: { status } }).setOptions(cross);
      const b = await bookingOf(bookingId);
      expect(await codeOf(cancelBooking(b, playerBy(player), {}, deps()))).toEqual({ status: 409, code: 'invalid_transition' });
      expect(await codeOf(previewCancellation(b, 'staff', ctx.services.now()))).toEqual({ status: 409, code: 'invalid_transition' });
    }
    expect(await refundRows()).toHaveLength(0);
  });

  it('a guest cancel logs activity with no actor', async () => {
    const { bookingId } = await paid();
    await cancelBooking(await bookingOf(bookingId), { kind: 'guest', ownerId: owner.ownerId }, {}, deps());
    const log = await ActivityLog.findOne({ ownerId: owner.ownerId, action: 'booking.cancelled' }).lean();
    expect(log!.actorId).toBeNull();
    expect(String(log!.entityId)).toBe(bookingId);
    expect((await bookingOf(bookingId)).cancelledBy).toBe('guest');
    const created = await ActivityLog.findOne({ ownerId: owner.ownerId, action: 'refund.created' }).lean();
    expect(created!.actorId).toBeNull();
  });
});
