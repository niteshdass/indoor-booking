import type { ClientSession } from 'mongoose';
import { bookingPaymentStatus } from '@booking/shared';
import type { Config } from '../config';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { runInTransaction } from '../db';
import type { AppServices } from '../services';
import { logActivity, logSystemActivity, type ActivityEntry } from '../tenancy/activityLog.model';
import { GatewayError, gatewayFor } from './gateway';
import { loadGateway } from './gateway.model';
import { Refund, type RefundDoc, type RefundReason, type RuleApplied } from './refund.model';

export const RECONCILE_AFTER_MINUTES = 10;
export const MAX_DISPATCH_ATTEMPTS = 12;
const RECONCILE_BATCH = 100;

const cross = { crossTenant: true };

export type RefundPart = { paymentId: unknown; method: 'card' | 'cash'; amount: number };

/**
 * Splits `amount` over the booking's payments: card before cash, newest first, within each payment's
 * unrefunded room. Excess payments are not part of amountPaid, so they are never offered.
 */
export function allocateRefund(payments: PaymentDoc[], amount: number): RefundPart[] {
  const usable = payments
    .filter((p) => p.status === 'succeeded' && !p.excess && (p.method === 'card' || p.method === 'cash') && p.amount - p.refundedAmount > 0)
    .sort((a, b) => Number(b.method === 'card') - Number(a.method === 'card') || (String(a._id) < String(b._id) ? 1 : -1));
  const parts: RefundPart[] = [];
  let left = amount;
  for (const p of usable) {
    if (left <= 0) break;
    const take = Math.min(left, p.amount - p.refundedAmount);
    parts.push({ paymentId: p._id, method: p.method as 'card' | 'cash', amount: take });
    left -= take;
  }
  if (left > 0) throw new Error('Refund exceeds what was paid');
  return parts;
}

const logRefund = (
  refund: { ownerId: unknown; venueId: unknown; _id: unknown },
  entry: Omit<ActivityEntry, 'entity' | 'entityId' | 'venueId'>,
  now: Date,
  session: ClientSession,
  actor?: { ownerId: string; userId: string },
) => {
  const full = { ...entry, entity: 'refund', entityId: String(refund._id), venueId: String(refund.venueId) };
  return actor ? logActivity(actor, full, now, session) : logSystemActivity(String(refund.ownerId), full, now, session);
};

/**
 * Phase 1, inside the caller's transaction: records a pending refund per part and reserves its
 * amount on the payment (and, for a cancellation, the booking) so nothing can be refunded twice.
 */
export async function reserveRefunds(
  input: {
    booking: BookingDoc;
    parts: RefundPart[];
    reason: RefundReason;
    ruleApplied: RuleApplied | null;
    by: string | null;
    now: Date;
    /** Overrides the payment's currency (amount_mismatch only). */
    currency?: string;
    retryOf?: unknown;
  },
  session: ClientSession,
): Promise<RefundDoc[]> {
  const { booking, parts, reason, by, now } = input;
  const ownerId = String(booking.ownerId);
  const rows: RefundDoc[] = [];
  for (const part of parts) {
    const payment = await Payment.findOne({ ownerId, _id: part.paymentId }).session(session);
    // A mismatched charge may have taken more than the payment row says; the gateway holds the received amount.
    const room = reason === 'amount_mismatch' || (payment != null && part.amount <= payment.amount - payment.refundedAmount);
    if (!payment || !room) throw new Error('Refund exceeds what was paid');
    if (part.method === 'card' && payment.method !== 'card') throw new Error('A card refund needs a card payment');
    const reserved = await Payment.updateOne(
      { ownerId, _id: payment._id, refundedAmount: payment.refundedAmount },
      { $inc: { refundedAmount: part.amount } },
      { session },
    );
    if (reserved.matchedCount !== 1) throw new Error('Payment changed while reserving a refund');
    const card = part.method === 'card';
    const [row] = await Refund.create(
      [
        {
          ownerId,
          venueId: booking.venueId,
          bookingId: booking._id,
          paymentId: payment._id,
          amount: part.amount,
          currency: input.currency ?? payment.currency,
          reason,
          method: part.method,
          gateway: card ? payment.gateway : null,
          gatewayAccountId: card ? payment.gatewayAccountId : null,
          status: 'pending',
          ruleApplied: input.ruleApplied,
          retryOf: input.retryOf ?? null,
          by,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session },
    );
    rows.push(row!);
    await logRefund(
      row!,
      {
        action: 'refund.created',
        after: { bookingId: String(booking._id), paymentId: String(payment._id), amount: part.amount, method: part.method, reason, status: 'pending' },
      },
      now,
      session,
      by ? { ownerId, userId: by } : undefined,
    );
  }
  if (reason === 'cancellation') {
    const total = parts.reduce((n, p) => n + p.amount, 0);
    await Booking.updateOne({ ownerId, _id: booking._id }, { $inc: { amountRefunded: total } }, { session });
  }
  return rows;
}

type Outcome = {
  status: 'pending' | 'succeeded' | 'failed';
  gatewayRef?: string | null;
  failureCode?: string | null;
  /** A late `refund.failed` may reverse a refund recorded as succeeded. */
  allowFromSucceeded?: boolean;
};

/**
 * Records what the gateway (or staff) decided; returns whether anything changed. A failure
 * releases the reservation. Opens no transaction: callers wrap it in runInTransaction.
 */
export async function settleRefund(
  ownerId: string,
  refundId: unknown,
  outcome: Outcome,
  now: Date,
  session: ClientSession,
  actor?: { ownerId: string; userId: string },
): Promise<boolean> {
  if (outcome.status === 'pending') {
    // Still in flight: only remember the gateway's reference.
    if (!outcome.gatewayRef) return false;
    const res = await Refund.updateOne(
      { ownerId, _id: refundId, status: 'pending', gatewayRef: { $ne: outcome.gatewayRef } },
      { $set: { gatewayRef: outcome.gatewayRef, updatedAt: now } },
      { session, timestamps: false },
    );
    return res.modifiedCount === 1;
  }

  const from = outcome.allowFromSucceeded && outcome.status === 'failed' ? { $in: ['pending', 'succeeded'] } : 'pending';
  const before = await Refund.findOneAndUpdate(
    { ownerId, _id: refundId, status: from },
    {
      $set: {
        status: outcome.status,
        ...(outcome.gatewayRef === undefined ? {} : { gatewayRef: outcome.gatewayRef }),
        failureCode: outcome.failureCode ?? null,
        settledAt: now,
        updatedAt: now,
      },
    },
    { session, new: false, timestamps: false },
  );
  if (!before) return false;

  if (outcome.status === 'failed') {
    await Payment.updateOne({ ownerId, _id: before.paymentId }, { $inc: { refundedAmount: -before.amount } }, { session });
    if (before.reason === 'cancellation') {
      const booking = await Booking.findOneAndUpdate(
        { ownerId, _id: before.bookingId },
        { $inc: { amountRefunded: -before.amount } },
        { session, new: true },
      );
      if (booking) {
        await Booking.updateOne(
          { ownerId, _id: booking._id },
          { $set: { paymentStatus: bookingPaymentStatus(booking.amountPaid, booking.amountRefunded, booking.total) } },
          { session },
        );
      }
    }
  }
  await logRefund(
    before,
    {
      action: `refund.${outcome.status}`,
      before: { status: before.status },
      after: { status: outcome.status, amount: before.amount, failureCode: outcome.failureCode ?? null },
    },
    now,
    session,
    actor,
  );
  return true;
}

/**
 * Phase 2, after the reserving transaction committed: sends a card refund to the gateway that
 * took the payment. Gateway trouble leaves the row pending for reconcileRefunds; it never throws for it.
 * Returns whether this call worked on the refund (false when it was skipped or another dispatcher won).
 */
export async function dispatchRefund(
  refundId: string,
  ownerId: string,
  deps: { config: Config; services: AppServices },
): Promise<boolean> {
  const now = deps.services.now();
  const refund = await Refund.findOne({ ownerId, _id: refundId });
  if (!refund || refund.method !== 'card' || refund.status !== 'pending') return false;
  const settle = (outcome: Outcome) => runInTransaction((s) => settleRefund(ownerId, refund._id, outcome, now, s));
  // Compare-and-set on the row as read: of two concurrent dispatchers only one gets the claim.
  const claim = (dispatched: boolean) =>
    Refund.findOneAndUpdate(
      { ownerId, _id: refund._id, status: 'pending', attempts: refund.attempts, updatedAt: refund.updatedAt },
      { $set: { ...(dispatched ? { dispatchedAt: now } : {}), updatedAt: now }, $inc: { attempts: 1 } },
      { new: true, timestamps: false },
    );
  /** The gateway could not be reached: count the attempt, and give up once there have been too many. */
  const retryLater = async () => {
    const bumped = await claim(false);
    if (!bumped) return false;
    if (bumped.attempts >= MAX_DISPATCH_ATTEMPTS) await settle({ status: 'failed', failureCode: 'gateway_unreachable' });
    return true;
  };

  // No key or adapter is a deployment problem that a later run may fix; only a missing or replaced account is final.
  if (!deps.config.paymentsKey || !gatewayFor(deps.services, refund.gateway!)) return retryLater();
  const loaded = await loadGateway(ownerId, refund.gateway!, deps.config, deps.services);
  if (!loaded || loaded.row.accountId !== refund.gatewayAccountId) {
    // Once dispatched, the money may have moved at the old account.
    await settle({ status: 'failed', failureCode: refund.dispatchedAt ? 'account_changed_after_dispatch' : 'account_changed' });
    return true;
  }
  const payment = await Payment.findOne({ ownerId, _id: refund.paymentId });
  if (!payment?.gatewayRef) {
    await settle({ status: 'failed', failureCode: 'no_charge' });
    return true;
  }
  const { gateway, creds } = loaded;
  const gatewayRef = payment.gatewayRef;

  if (refund.dispatchedAt) {
    // An earlier call may have landed (or its idempotency key expired): adopt what the gateway has.
    try {
      const found = await gateway.findRefund(creds, { gatewayRef, refundId: String(refund._id) });
      if (found) {
        await settle({ status: found.status, gatewayRef: found.refundRef, failureCode: found.failureCode });
        return true;
      }
    } catch (err) {
      if (err instanceof GatewayError) return retryLater();
      throw err;
    }
  }

  const claimed = await claim(true);
  if (!claimed) return false;

  try {
    const result = await gateway.refund(creds, {
      gatewayRef,
      amount: refund.amount,
      idempotencyKey: `refund_${String(refund._id)}`,
      refundId: String(refund._id),
    });
    await settle({ status: result.status, gatewayRef: result.refundRef, failureCode: result.failureCode });
  } catch (err) {
    if (!(err instanceof GatewayError)) throw err;
    if (claimed.attempts >= MAX_DISPATCH_ATTEMPTS) await settle({ status: 'failed', failureCode: 'gateway_unreachable' });
  }
  return true;
}

/** Sweeper: re-dispatches card refunds stuck pending (outage, crash between commit and dispatch). */
export async function reconcileRefunds(
  now: Date,
  deps: { config: Config; services: AppServices },
): Promise<{ dispatched: number }> {
  const stuck = await Refund.find({
    method: 'card',
    status: 'pending',
    updatedAt: { $lte: new Date(now.getTime() - RECONCILE_AFTER_MINUTES * 60_000) },
  })
    .setOptions(cross)
    .sort({ updatedAt: 1 })
    .limit(RECONCILE_BATCH);
  let dispatched = 0;
  for (const row of stuck) {
    try {
      if (await dispatchRefund(String(row._id), String(row.ownerId), deps)) dispatched += 1;
    } catch (err) {
      console.error(`[refunds] reconcile of ${String(row._id)} failed`, err);
    }
  }
  return { dispatched };
}

export function refundJson(r: RefundDoc) {
  return {
    id: String(r.id),
    paymentId: String(r.paymentId),
    method: r.method,
    amount: r.amount,
    currency: r.currency,
    reason: r.reason,
    ruleApplied: r.ruleApplied ? { minHoursBefore: r.ruleApplied.minHoursBefore ?? null, percent: r.ruleApplied.percent } : null,
    status: r.status,
    failureCode: r.failureCode,
    retryOf: r.retryOf ? String(r.retryOf) : null,
    createdAt: r.createdAt.toISOString(),
  };
}
