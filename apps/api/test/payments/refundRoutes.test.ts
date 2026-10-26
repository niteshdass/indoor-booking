import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { connectStripe } from '../helpers/stripe';
import { runInTransaction } from '../../src/db';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Booking, type BookingDoc } from '../../src/bookings/booking.model';
import { Payment } from '../../src/bookings/payment.model';
import { newReference } from '../../src/bookings/reference';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { Refund } from '../../src/payments/refund.model';
import { reserveRefunds, settleRefund } from '../../src/payments/refunds';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(), Booking.init(), Payment.init(),
    PaymentGatewayAccount.init(), Refund.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

const cross = { crossTenant: true };

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let staff: Awaited<ReturnType<typeof addMember>>;
let venueId: string;
let turfId: string;
let accountId: string;

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, Payment, PaymentGatewayAccount, Refund].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  staff = await addMember(ctx.services, owner.ownerId, { roleKey: 'staff' });
  const venue = await seedVenue(owner.ownerId, { published: true });
  const turf = await seedTurf(owner.ownerId, venue.id as string);
  venueId = venue.id as string;
  turfId = turf.id as string;
  ({ accountId } = await connectStripe(ctx.app, owner));
});

const post = (path: string, token = owner.token) =>
  request(ctx.app).post(`/api/v1/owners/${owner.ownerId}${path}`).set(...bearer(token)).send({});
const refundOf = async (id: unknown) => (await Refund.findById(id).setOptions(cross).lean())!;
const paymentOf = async (id: unknown) => (await Payment.findById(id).setOptions(cross).lean())!;
const bookingOf = async (id: unknown) => (await Booking.findById(id).setOptions(cross).lean())!;
const rows = () => Refund.find({ ownerId: owner.ownerId }).sort({ _id: 1 }).lean();

/** A cancelled 3000 booking whose only payment is a `method` payment, with a 3000 cancellation refund reserved. */
async function cancelled(method: 'card' | 'cash', venue = venueId) {
  const startAt = new Date('2026-01-02T12:00:00Z');
  const endAt = new Date(startAt.getTime() + 3600_000);
  const booking: BookingDoc = await Booking.create({
    ownerId: owner.ownerId, venueId: venue, turfId, reference: newReference(), businessDate: '2026-01-02', startAt, endAt,
    slots: [{ startAt, endAt, price: 3000 }], addons: [], currency: 'BDT', subtotal: 3000, addonsTotal: 0,
    total: 3000, advanceRequired: 0, amountPaid: 3000, status: 'cancelled', paymentStatus: 'paid', source: 'online',
    policySnapshot: { paymentPolicy: null, refundRules: [] },
  });
  const payment = await Payment.create({
    ownerId: owner.ownerId, venueId: venue, bookingId: booking._id, method, amount: 3000, currency: 'BDT', status: 'succeeded',
    ...(method === 'card' ? { gateway: 'stripe', gatewayAccountId: accountId, gatewayRef: 'pi_1' } : {}),
  });
  const [refund] = await runInTransaction((s) =>
    reserveRefunds(
      {
        booking, parts: [{ paymentId: payment._id, method, amount: 3000 }], reason: 'cancellation',
        ruleApplied: { minHoursBefore: null, percent: 100 }, by: owner.userId, now: ctx.services.now(),
      },
      s,
    ),
  );
  await Booking.updateOne({ _id: booking._id }, { $set: { paymentStatus: 'refunded' } }).setOptions(cross);
  return { booking, payment, refund: refund! };
}

/** `cancelled(...)` with the refund then failed, which releases the reservation. */
async function failed(method: 'card' | 'cash' = 'card', venue = venueId) {
  const c = await cancelled(method, venue);
  await runInTransaction((s) => settleRefund(owner.ownerId, c.refund._id, { status: 'failed', failureCode: 'card_declined' }, ctx.services.now(), s));
  return c;
}

describe('retry', () => {
  it('re-sends a failed card refund once', async () => {
    const { booking, payment, refund } = await failed();
    ctx.services.stripe.refundStatus = 'failed';
    const first = await post(`/refunds/${refund._id}/retry`);
    expect(first.status).toBe(201);
    expect(first.body.refund).toMatchObject({ status: 'failed', amount: 3000, reason: 'cancellation', method: 'card', retryOf: String(refund._id) });
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'card_declined' });

    // The next attempt chains off the newest failed row.
    ctx.services.stripe.refundStatus = 'succeeded';
    const second = await post(`/refunds/${first.body.refund.id}/retry`);
    expect(second.status).toBe(201);
    expect(second.body.refund).toMatchObject({ status: 'succeeded', retryOf: first.body.refund.id });
    const list = await rows();
    expect(list.map((r) => r.status)).toEqual(['failed', 'failed', 'succeeded']);
    expect(String(list[2]!.by)).toBe(owner.userId);
    expect(list[2]!.ruleApplied).toEqual({ minHoursBefore: null, percent: 100 });
    expect(await paymentOf(payment._id)).toMatchObject({ refundedAmount: 3000 });
    expect(await bookingOf(booking._id)).toMatchObject({ amountRefunded: 3000, paymentStatus: 'refunded' });

    expect((await post(`/refunds/${second.body.refund.id}/retry`)).status).toBe(409);
    expect(await rows()).toHaveLength(3);
  });

  it('retry of a refund on a replaced account is refused', async () => {
    const { refund } = await failed();
    await connectStripe(ctx.app, owner, { secretKey: 'sk_test_replaced' });
    const res = await post(`/refunds/${refund._id}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
    expect(await rows()).toHaveLength(1);
  });

  it('retry and record-cash of the same failed refund only replace it once', async () => {
    const { refund, payment } = await failed();
    expect((await post(`/refunds/${refund._id}/retry`)).status).toBe(201);
    const res = await post(`/refunds/${refund._id}/record-cash`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('invalid_transition');
    expect(await rows()).toHaveLength(2);
    expect(await paymentOf(payment._id)).toMatchObject({ refundedAmount: 3000 });
  });
});

describe('retry edge cases', () => {
  it('a dispatch failure still answers 201 and leaves the row pending for reconcile', async () => {
    const { payment, refund } = await failed();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The claim goes through; settling the gateway's answer then fails with a non-gateway error.
    const real = Refund.findOneAndUpdate.bind(Refund);
    let calls = 0;
    const claim = vi.spyOn(Refund, 'findOneAndUpdate').mockImplementation(((...args: Parameters<typeof real>) => {
      calls += 1;
      return calls === 1 ? real(...args) : Promise.reject(new Error('boom'));
    }) as unknown as typeof Refund.findOneAndUpdate);
    try {
      const res = await post(`/refunds/${refund._id}/retry`);
      expect(res.status).toBe(201);
      expect(res.body.refund).toMatchObject({ status: 'pending', retryOf: String(refund._id) });
      expect(spy.mock.calls.some((c) => String(c[0]).startsWith('[refunds] dispatch of'))).toBe(true);
    } finally {
      claim.mockRestore();
      spy.mockRestore();
    }
    expect(await paymentOf(payment._id)).toMatchObject({ refundedAmount: 3000 });
  });

  it('refuses when the released room has been used elsewhere', async () => {
    const { payment, refund } = await failed();
    await Payment.updateOne({ _id: payment._id }, { $set: { refundedAmount: 1000 } }).setOptions(cross);
    for (const path of ['retry', 'record-cash']) {
      const res = await post(`/refunds/${refund._id}/${path}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('invalid_transition');
    }
    expect(await rows()).toHaveLength(1);
    expect(await paymentOf(payment._id)).toMatchObject({ refundedAmount: 1000 });
  });

  it('answers 503 when payments are not configured on the server', async () => {
    const { refund } = await failed();
    const bare = buildTestApp({ services: ctx.services, config: { paymentsKey: undefined } });
    const res = await request(bare.app)
      .post(`/api/v1/owners/${owner.ownerId}/refunds/${refund._id}/retry`)
      .set(...bearer(owner.token))
      .send({});
    expect(res.status).toBe(503);
    expect(await rows()).toHaveLength(1);
  });

  it('answers 503 when the gateway credentials cannot be decrypted', async () => {
    const { refund } = await failed();
    await PaymentGatewayAccount.updateMany({ ownerId: owner.ownerId }, { $set: { 'keys.test.credentialsEncrypted': 'corrupt' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await post(`/refunds/${refund._id}/retry`);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('payments_unconfigured');
    } finally {
      spy.mockRestore();
    }
    expect(await rows()).toHaveLength(1);
  });

  it('refuses the wrong kind of row', async () => {
    const pendingCard = await cancelled('card');
    const cash = await failed('cash');
    const cases: [string, unknown][] = [
      ['record-cash', pendingCard.refund._id],
      ['retry', pendingCard.refund._id],
      ['retry', cash.refund._id],
    ];
    for (const [path, id] of cases) {
      const res = await post(`/refunds/${id}/${path}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('invalid_transition');
    }
    expect(await rows()).toHaveLength(2);
    expect(await refundOf(pendingCard.refund._id)).toMatchObject({ status: 'pending' });
  });
});

describe('record-cash', () => {
  it('settles a pending cash refund', async () => {
    const { booking, refund } = await cancelled('cash');
    const res = await post(`/refunds/${refund._id}/record-cash`);
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ id: String(refund._id), status: 'succeeded', method: 'cash' });
    const row = await refundOf(refund._id);
    expect(String(row.by)).toBe(owner.userId);
    expect(row.settledAt).toEqual(ctx.services.now());
    expect(await bookingOf(booking._id)).toMatchObject({ amountRefunded: 3000, paymentStatus: 'refunded' });
  });

  it('replaces a failed card refund with cash', async () => {
    const { booking, payment, refund } = await failed();
    expect(await bookingOf(booking._id)).toMatchObject({ amountRefunded: 0, paymentStatus: 'paid' });
    const res = await post(`/refunds/${refund._id}/record-cash`);
    expect(res.status).toBe(201);
    expect(res.body.refund).toMatchObject({ status: 'succeeded', method: 'cash', amount: 3000, retryOf: String(refund._id), paymentId: String(payment._id) });
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed' });
    const row = await refundOf(res.body.refund.id);
    expect(String(row.by)).toBe(owner.userId);
    expect(row).toMatchObject({ gateway: null, gatewayAccountId: null });
    expect(row.settledAt).toEqual(ctx.services.now());
    expect(await bookingOf(booking._id)).toMatchObject({ amountRefunded: 3000, paymentStatus: 'refunded' });
    expect(await paymentOf(payment._id)).toMatchObject({ refundedAmount: 3000 });
  });

  it('record-cash twice does nothing more', async () => {
    const { refund } = await cancelled('cash');
    expect((await post(`/refunds/${refund._id}/record-cash`)).status).toBe(200);
    const again = await post(`/refunds/${refund._id}/record-cash`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_transition');

    const f = await failed();
    expect((await post(`/refunds/${f.refund._id}/record-cash`)).status).toBe(201);
    expect((await post(`/refunds/${f.refund._id}/record-cash`)).status).toBe(409);
    expect(await rows()).toHaveLength(3);
    expect(await paymentOf(f.payment._id)).toMatchObject({ refundedAmount: 3000 });
  });
});

describe('venue scope', () => {
  it('a manager limited to another venue gets 404 and nothing changes', async () => {
    const other = (await seedVenue(owner.ownerId, { published: true, slug: 'other' })).id as string;
    const manager = await addMember(ctx.services, owner.ownerId, { roleKey: 'manager', venueIds: [venueId] });
    const card = await failed('card', other);
    const cash = await cancelled('cash', other);
    for (const [path, id] of [['retry', card.refund._id], ['record-cash', card.refund._id], ['record-cash', cash.refund._id]] as const) {
      expect((await post(`/refunds/${id}/${path}`, manager.token)).status).toBe(404);
    }
    expect((await post(`/refunds/${new mongoose.Types.ObjectId()}/retry`)).status).toBe(404);
    expect((await post(`/refunds/${new mongoose.Types.ObjectId()}/record-cash`)).status).toBe(404);
    expect(await rows()).toHaveLength(2);
    expect(await refundOf(cash.refund._id)).toMatchObject({ status: 'pending' });
    expect(await refundOf(card.refund._id)).toMatchObject({ status: 'failed' });
  });
});

describe('permissions', () => {
  it('refund routes need refund.issue', async () => {
    const { refund } = await failed();
    expect((await post(`/refunds/${refund._id}/retry`, staff.token)).status).toBe(403);
    expect((await post(`/refunds/${refund._id}/record-cash`, staff.token)).status).toBe(403);
    expect(await rows()).toHaveLength(1);
  });
});
