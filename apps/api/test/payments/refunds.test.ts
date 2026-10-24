import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
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
import { Payment, type PaymentDoc } from '../../src/bookings/payment.model';
import { newReference } from '../../src/bookings/reference';
import { PaymentGatewayAccount } from '../../src/payments/gateway.model';
import { Refund } from '../../src/payments/refund.model';
import {
  MAX_DISPATCH_ATTEMPTS,
  allocateRefund,
  dispatchRefund,
  reconcileRefunds,
  refundJson,
  reserveRefunds,
  settleRefund,
} from '../../src/payments/refunds';

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
const MIN = 60_000;

let ctx: ReturnType<typeof buildTestApp>;
let owner: Awaited<ReturnType<typeof seedOwner>>;
let venueId: string;
let turfId: string;
let accountId: string;
const deps = () => ({ config: ctx.config, services: ctx.services });

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } }),
    ...[ActivityLog, Venue, Turf, Booking, Payment, PaymentGatewayAccount, Refund].map((m) =>
      (m as typeof Venue).deleteMany({}).setOptions(cross),
    ),
  ]);
  ctx = buildTestApp();
  owner = await seedOwner(ctx.services);
  const venue = await seedVenue(owner.ownerId, { published: true });
  const turf = await seedTurf(owner.ownerId, venue.id as string);
  venueId = venue.id as string;
  turfId = turf.id as string;
  ({ accountId } = await connectStripe(ctx.app, owner));
});

async function seedBooking(amountPaid: number): Promise<BookingDoc> {
  const startAt = new Date('2026-01-02T12:00:00Z');
  const endAt = new Date(startAt.getTime() + 3600_000);
  return Booking.create({
    ownerId: owner.ownerId, venueId, turfId, reference: newReference(), businessDate: '2026-01-02', startAt, endAt,
    slots: [{ startAt, endAt, price: 3000 }], addons: [], currency: 'BDT', subtotal: 3000, addonsTotal: 0,
    total: 3000, advanceRequired: 0, amountPaid, status: 'confirmed',
    paymentStatus: amountPaid >= 3000 ? 'paid' : 'partially_paid', source: 'online',
    policySnapshot: { paymentPolicy: null, refundRules: [] },
  });
}

function seedPayment(booking: BookingDoc, over: Partial<{ method: string; amount: number; status: string; refundedAmount: number; gatewayRef: string | null }> = {}) {
  const method = over.method ?? 'card';
  return Payment.create({
    ownerId: owner.ownerId, venueId, bookingId: booking._id, method, amount: over.amount ?? 3000, currency: 'BDT',
    status: over.status ?? 'succeeded', refundedAmount: over.refundedAmount ?? 0,
    ...(method === 'card'
      ? { gateway: 'stripe', gatewayAccountId: accountId, gatewayRef: over.gatewayRef === undefined ? 'pi_1' : over.gatewayRef }
      : {}),
  });
}

const reserve = (booking: BookingDoc, parts: Parameters<typeof reserveRefunds>[0]['parts'], over: Partial<Parameters<typeof reserveRefunds>[0]> = {}) =>
  runInTransaction((s) =>
    reserveRefunds(
      { booking, parts, reason: 'cancellation', ruleApplied: { minHoursBefore: 24, percent: 100 }, by: null, now: ctx.services.now(), ...over },
      s,
    ),
  );
const createCalls = () => ctx.services.stripe.calls.filter((c) => c.method === 'refunds.create');
const listCalls = () => ctx.services.stripe.calls.filter((c) => c.method === 'refunds.list');
const refundOf = async (id: unknown) => (await Refund.findById(id).setOptions(cross).lean())!;
const paymentOf = async (id: unknown) => (await Payment.findById(id).setOptions(cross).lean())!;
const bookingOf = async (id: unknown) => (await Booking.findById(id).setOptions(cross).lean())!;

/** A card booking of 3000, one reserved refund of `amount`. */
async function reserved(amount = 3000) {
  const booking = await seedBooking(3000);
  const payment = await seedPayment(booking);
  const [refund] = await reserve(booking, [{ paymentId: payment._id, method: 'card', amount }]);
  return { booking, payment, refund: refund! };
}

describe('allocateRefund', () => {
  const pay = (id: string, method: string, amount: number, over: Partial<{ status: string; refundedAmount: number }> = {}) =>
    ({ _id: new mongoose.Types.ObjectId(id.padStart(24, '0')), method, amount, status: over.status ?? 'succeeded', refundedAmount: over.refundedAmount ?? 0 }) as unknown as PaymentDoc;

  it('takes card before cash, newest first', () => {
    const card3000 = pay('1', 'card', 3000);
    const cash = pay('2', 'cash', 2000);
    const card1000 = pay('3', 'card', 1000);
    expect(allocateRefund([card3000, cash, card1000], 3500)).toEqual([
      { paymentId: card1000._id, method: 'card', amount: 1000 },
      { paymentId: card3000._id, method: 'card', amount: 2500 },
    ]);
  });

  it('skips failed payments and already-refunded room', () => {
    const failed = pay('3', 'card', 1000, { status: 'failed' });
    const partly = pay('2', 'card', 1000, { refundedAmount: 700 });
    const cash = pay('1', 'cash', 1000);
    expect(allocateRefund([failed, partly, cash], 800)).toEqual([
      { paymentId: partly._id, method: 'card', amount: 300 },
      { paymentId: cash._id, method: 'cash', amount: 500 },
    ]);
  });

  it('throws when payments cannot cover the amount', () => {
    expect(() => allocateRefund([pay('1', 'card', 1000)], 1001)).toThrow('Refund exceeds what was paid');
  });
});

describe('refund service', () => {
  it('reserves, then dispatches through the gateway once', async () => {
    const { booking, payment, refund } = await reserved(2000);
    expect(refund.status).toBe('pending');
    expect(refund.gatewayAccountId).toBe(accountId);
    expect((await paymentOf(payment._id)).refundedAmount).toBe(2000);
    expect((await bookingOf(booking._id)).amountRefunded).toBe(2000);
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'refund.created' })).toBe(1);

    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const row = await refundOf(refund._id);
    expect(row.status).toBe('succeeded');
    expect(row.gatewayRef).toMatch(/^re_/);
    expect(row.settledAt).toBeTruthy();
    expect((await paymentOf(payment._id)).refundedAmount).toBe(2000);
    expect((await bookingOf(booking._id)).amountRefunded).toBe(2000);
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0]!.idempotencyKey).toBe(`refund_${String(refund._id)}`);
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'refund.succeeded' })).toBe(1);

    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    expect(ctx.services.stripe.calls.filter((c) => c.method.startsWith('refunds.'))).toHaveLength(1);
    expect(refundJson((await Refund.findById(refund._id).setOptions(cross))!)).toMatchObject({
      id: String(refund._id), method: 'card', amount: 2000, status: 'succeeded', retryOf: null,
    });
  });

  it('a declined refund fails and releases the reservation', async () => {
    const { booking, payment, refund } = await reserved(3000);
    // What the cancel flow would have written for a full reservation.
    await Booking.updateOne({ ownerId: owner.ownerId, _id: booking._id }, { $set: { paymentStatus: 'refunded' } });
    ctx.services.stripe.refundStatus = 'failed';
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const row = await refundOf(refund._id);
    expect(row.status).toBe('failed');
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
    const b = await bookingOf(booking._id);
    expect(b.amountRefunded).toBe(0);
    expect(b.paymentStatus).toBe('paid');
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: 'refund.failed' })).toBe(1);
  });

  it('a gateway outage leaves the refund pending for reconcile', async () => {
    const { refund } = await reserved();
    ctx.services.stripe.fail('refunds.create', 'api');
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    let row = await refundOf(refund._id);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);

    expect(await reconcileRefunds(ctx.services.now(), deps())).toEqual({ dispatched: 0 });
    ctx.services.clock.advance(11 * MIN);
    expect(await reconcileRefunds(ctx.services.now(), deps())).toEqual({ dispatched: 1 });
    row = await refundOf(refund._id);
    expect(row.status).toBe('succeeded');
    expect(listCalls()).toHaveLength(1);
    expect(createCalls()).toHaveLength(2);
    const order = ctx.services.stripe.calls.map((c) => c.method).filter((m) => m.startsWith('refunds.'));
    expect(order).toEqual(['refunds.create', 'refunds.list', 'refunds.create']);
  });

  it('adopts an earlier refund instead of refunding twice', async () => {
    const { refund } = await reserved();
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const first = await refundOf(refund._id);
    const old = new Date(ctx.services.now().getTime() - MIN);
    await Refund.collection.updateOne(
      { _id: refund._id },
      { $set: { status: 'pending', gatewayRef: null, settledAt: null, dispatchedAt: old, updatedAt: old } },
    );
    ctx.services.clock.advance(25 * 60 * MIN);
    await reconcileRefunds(ctx.services.now(), deps());
    const row = await refundOf(refund._id);
    expect(row.status).toBe('succeeded');
    expect(row.gatewayRef).toBe(first.gatewayRef);
    expect(createCalls()).toHaveLength(1);
  });

  it('fails a refund whose account was replaced', async () => {
    const { booking, payment, refund } = await reserved();
    const again = await connectStripe(ctx.app, owner, { secretKey: 'sk_test_replaced' });
    expect(again.accountId).not.toBe(accountId);
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const row = await refundOf(refund._id);
    expect(row).toMatchObject({ status: 'failed', failureCode: 'account_changed' });
    expect(createCalls()).toHaveLength(0);
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
    expect((await bookingOf(booking._id)).amountRefunded).toBe(0);
  });

  it('fails a refund whose account was replaced after it was dispatched', async () => {
    const { refund } = await reserved();
    await Refund.updateOne({ ownerId: owner.ownerId, _id: refund._id }, { $set: { dispatchedAt: ctx.services.now() } });
    await connectStripe(ctx.app, owner, { secretKey: 'sk_test_replaced' });
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'account_changed_after_dispatch' });
  });

  it('fails a refund whose gateway account was removed', async () => {
    const { refund } = await reserved();
    await PaymentGatewayAccount.deleteMany({ ownerId: owner.ownerId });
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'account_changed' });
  });

  it('treats a missing encryption key as retryable, then gives up', async () => {
    const { payment, refund } = await reserved();
    const noKey = { config: { ...ctx.config, paymentsKey: undefined }, services: ctx.services };
    await dispatchRefund(String(refund._id), owner.ownerId, noKey);
    expect(await refundOf(refund._id)).toMatchObject({ status: 'pending', attempts: 1 });
    await Refund.updateOne({ ownerId: owner.ownerId, _id: refund._id }, { $set: { attempts: MAX_DISPATCH_ATTEMPTS - 1 } });
    await dispatchRefund(String(refund._id), owner.ownerId, noKey);
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'gateway_unreachable' });
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
    expect(createCalls()).toHaveLength(0);
  });

  it('counts a failed lookup as an attempt and gives up eventually', async () => {
    const { payment, refund } = await reserved();
    const where = { ownerId: owner.ownerId, _id: refund._id };
    await Refund.updateOne(where, { $set: { dispatchedAt: ctx.services.now() } });
    ctx.services.clock.advance(11 * MIN);
    ctx.services.stripe.fail('refunds.list', 'api');
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const row = await refundOf(refund._id);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row.updatedAt).toEqual(ctx.services.now());

    await Refund.updateOne(where, { $set: { attempts: MAX_DISPATCH_ATTEMPTS - 1 } });
    ctx.services.stripe.fail('refunds.list', 'api');
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'gateway_unreachable' });
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
  });

  it('two concurrent dispatchers call the gateway once', async () => {
    const { refund } = await reserved();
    await Promise.all([
      dispatchRefund(String(refund._id), owner.ownerId, deps()),
      dispatchRefund(String(refund._id), owner.ownerId, deps()),
    ]);
    expect(createCalls()).toHaveLength(1);
    expect((await refundOf(refund._id)).attempts).toBe(1);
  });

  it('rejects a card part against a cash payment', async () => {
    const booking = await seedBooking(3000);
    const payment = await seedPayment(booking, { method: 'cash' });
    await expect(reserve(booking, [{ paymentId: payment._id, method: 'card', amount: 100 }])).rejects.toThrow();
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
  });

  it('fails a refund whose payment has no charge', async () => {
    const booking = await seedBooking(3000);
    const payment = await seedPayment(booking, { gatewayRef: null });
    const [refund] = await reserve(booking, [{ paymentId: payment._id, method: 'card', amount: 100 }]);
    await dispatchRefund(String(refund!._id), owner.ownerId, deps());
    expect(await refundOf(refund!._id)).toMatchObject({ status: 'failed', failureCode: 'no_charge' });
  });

  it('gives up after MAX_DISPATCH_ATTEMPTS', async () => {
    const { payment, refund } = await reserved();
    await Refund.updateOne({ ownerId: owner.ownerId, _id: refund._id }, { $set: { attempts: MAX_DISPATCH_ATTEMPTS - 1 } });
    ctx.services.stripe.fail('refunds.create', 'api');
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    expect(await refundOf(refund._id)).toMatchObject({ status: 'failed', failureCode: 'gateway_unreachable', attempts: MAX_DISPATCH_ATTEMPTS });
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
  });

  it('cash refunds are never dispatched', async () => {
    const booking = await seedBooking(3000);
    const payment = await seedPayment(booking, { method: 'cash' });
    const [refund] = await reserve(booking, [{ paymentId: payment._id, method: 'cash', amount: 500 }]);
    expect(refund).toMatchObject({ method: 'cash', gateway: null, gatewayAccountId: null });
    await dispatchRefund(String(refund!._id), owner.ownerId, deps());
    ctx.services.clock.advance(11 * MIN);
    expect(await reconcileRefunds(ctx.services.now(), deps())).toEqual({ dispatched: 0 });
    expect((await refundOf(refund!._id)).status).toBe('pending');
    expect(ctx.services.stripe.calls.filter((c) => c.method.startsWith('refunds.'))).toHaveLength(0);
  });

  it('a pending gateway result keeps the row pending and stores the reference', async () => {
    const { refund } = await reserved();
    ctx.services.stripe.refundStatus = 'pending';
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const row = await refundOf(refund._id);
    expect(row.status).toBe('pending');
    expect(row.gatewayRef).toMatch(/^re_/);
    expect(row.settledAt).toBeNull();
    expect(await ActivityLog.countDocuments({ ownerId: owner.ownerId, action: /^refund\.(succeeded|failed)$/ })).toBe(0);
  });

  it('settleRefund only moves a succeeded refund to failed when allowed', async () => {
    const { booking, payment, refund } = await reserved();
    await dispatchRefund(String(refund._id), owner.ownerId, deps());
    const settle = (allowFromSucceeded?: boolean) =>
      runInTransaction((s) =>
        settleRefund(owner.ownerId, refund._id, { status: 'failed', failureCode: 'late', allowFromSucceeded }, ctx.services.now(), s),
      );
    expect(await settle()).toBe(false);
    expect((await refundOf(refund._id)).status).toBe('succeeded');
    expect(await settle(true)).toBe(true);
    expect(await settle(true)).toBe(false);
    expect((await refundOf(refund._id)).status).toBe('failed');
    expect((await paymentOf(payment._id)).refundedAmount).toBe(0);
    expect((await bookingOf(booking._id)).amountRefunded).toBe(0);
  });
});
