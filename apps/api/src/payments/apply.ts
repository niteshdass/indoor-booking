import mongoose, { type ClientSession } from 'mongoose';
import { paymentStatusFor, type AddonLine } from '@booking/shared';
import { lockAddon } from '../addons/guards';
import { offeredAddons } from '../addons/offered';
import { Booking, holdingFilter, type BookingDoc } from '../bookings/booking.model';
import { expireStaleHolds, limited, stockInUse } from '../bookings/create';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import { ActivityLog, logSystemActivity } from '../tenancy/activityLog.model';
import { lockTurf } from '../venues/guards';
import { Turf } from '../venues/turf.model';
import { Venue } from '../venues/venue.model';
import type { GatewayCredentials, GatewayEvent, PaymentGateway } from './gateway';
import { Refund } from './refund.model';
import type { WebhookOutcome } from './webhookEvent.model';

export type ApplyContext = { gateway: PaymentGateway; creds: GatewayCredentials; now: Date };

/** Thrown when a guarded write misses inside the transaction; aborts it so the webhook is retried. */
const changedUnderneath = () => new Error('Payment or booking changed while applying a webhook');

/**
 * Applies a normalized gateway event for `ownerId` inside `session`. Every write is conditional on
 * the status it read, so a second, concurrent or out-of-order delivery changes nothing.
 */
export async function applyEvent(
  ownerId: string,
  event: GatewayEvent,
  ctx: ApplyContext,
  session: ClientSession,
): Promise<WebhookOutcome> {
  if (event.kind === 'ignored') return 'ignored';
  const payment =
    event.paymentId && mongoose.isValidObjectId(event.paymentId)
      ? await Payment.findOne({ ownerId, _id: event.paymentId }).session(session)
      : null;
  if (!payment) return 'unmatched';
  const pending = { ownerId, _id: payment._id, status: 'pending' };

  if (event.kind === 'attempt_failed') {
    const res = await Payment.updateOne(pending, { $set: { failureCode: event.failureCode } }, { session });
    return res.matchedCount === 1 ? 'applied' : 'ignored';
  }
  if (event.kind === 'closed') {
    const res = await Payment.updateOne(pending, { $set: { status: 'failed' } }, { session });
    return res.matchedCount === 1 ? 'applied' : 'ignored';
  }

  if (payment.status !== 'pending') return 'ignored';
  if (event.amount !== payment.amount || event.currency !== payment.currency) return 'mismatch';

  const booking = await Booking.findOne({ ownerId, _id: payment.bookingId }).session(session);
  if (!booking) return 'ignored';
  await lockTurf({ ownerId }, String(booking.turfId), ctx.now, session);

  const succeeded = { ownerId, event, payment, booking, ctx, session };
  const holding = booking.status === 'awaiting_payment' && booking.holdExpiresAt != null && booking.holdExpiresAt > ctx.now;
  // A live hold still has its slots and stock; a lapsed or expired one gets them back only if nobody took them.
  if (holding && booking.endAt > ctx.now) return confirm(succeeded);
  const lapsed = booking.status === 'awaiting_payment' && !holding;
  if ((lapsed || booking.status === 'expired') && (await stillFree(ownerId, booking, ctx.now, session))) {
    return confirm(succeeded);
  }
  return refund(succeeded);
}

type Succeeded = {
  ownerId: string;
  event: Extract<GatewayEvent, { kind: 'succeeded' }>;
  payment: PaymentDoc;
  booking: BookingDoc;
  ctx: ApplyContext;
  session: ClientSession;
};

const pendingOf = (s: Succeeded) => ({ ownerId: s.ownerId, _id: s.payment._id, status: 'pending' });

/** Whether an expired or lapsed booking can have its slots and stock-limited add-ons back. */
async function stillFree(ownerId: string, booking: BookingDoc, now: Date, session: ClientSession): Promise<boolean> {
  if (booking.endAt <= now) return false;
  // A lapsed hold of someone else's still owns its locks; free them as createBooking would.
  await expireStaleHolds(ownerId, booking.turfId, booking, now, session, booking._id);
  const taken = await Booking.exists({
    ownerId,
    turfId: booking.turfId,
    _id: { $ne: booking._id },
    startAt: { $lt: booking.endAt },
    endAt: { $gt: booking.startAt },
    ...holdingFilter(now),
  }).session(session);
  if (taken) return false;

  const lines = booking.addons as AddonLine[];
  if (lines.length === 0) return true;
  const [venue, turf] = await Promise.all([
    Venue.findOne({ ownerId, _id: booking.venueId }).session(session),
    Turf.findOne({ ownerId, _id: booking.turfId }).session(session),
  ]);
  if (!venue || !turf) return false;
  const offered = await offeredAddons(ownerId, venue, turf);
  const stocked = [...new Set(limited(offered, lines))].sort();
  for (const addonId of stocked) await lockAddon({ ownerId }, addonId, now, session);
  const inUse = await stockInUse(ownerId, venue, stocked, booking, now, session);
  return stocked.every((addonId) => {
    const units = lines
      .filter((l) => l.addonId === addonId)
      .reduce((n, l) => n + (l.pricingType === 'per_unit' ? l.quantity : 1), 0);
    const stock = offered.find((o) => o.addonId === addonId)!.stock!;
    return (inUse[addonId] ?? 0) + units <= stock;
  });
}

/**
 * Confirms a hold, or revives an expired booking by taking its slot locks back. The revive bypasses
 * BOOKING_TRANSITIONS on purpose: expired stays terminal for staff.
 */
async function confirm(s: Succeeded): Promise<WebhookOutcome> {
  const { ownerId, event, payment, booking, ctx, session } = s;
  const from = booking.status as 'awaiting_payment' | 'expired';
  if (from === 'expired') {
    await SlotLock.create(
      booking.slots.map((slot) => ({ ownerId, turfId: booking.turfId, startAt: slot.startAt, bookingId: booking._id })),
      { session, ordered: true },
    );
  }
  const paid = await Payment.updateOne(
    pendingOf(s),
    { $set: { status: 'succeeded', gatewayRef: event.gatewayRef } },
    { session },
  );
  const amountPaid = booking.amountPaid + event.amount;
  const confirmed = await Booking.updateOne(
    { ownerId, _id: booking._id, status: from, amountPaid: booking.amountPaid },
    {
      $set: { status: 'confirmed', amountPaid, paymentStatus: paymentStatusFor(amountPaid, booking.total), holdExpiresAt: null },
    },
    { session },
  );
  if (paid.matchedCount !== 1 || confirmed.matchedCount !== 1) throw changedUnderneath();

  await logSystemActivity(
    ownerId,
    {
      action: from === 'expired' ? 'booking.revived' : 'booking.confirmed',
      entity: 'booking',
      entityId: String(booking._id),
      venueId: String(booking.venueId),
      before: { status: from },
      after: { status: 'confirmed', via: 'payment', paymentId: String(payment._id), amount: event.amount },
    },
    ctx.now,
    session,
  );
  return 'applied';
}

/**
 * Refunds a payment its booking can no longer use, through the account that took it. Every write
 * that records the decision lands before the gateway call, which is the last step: a gateway error
 * aborts it all, and the idempotency key makes a retried transaction or webhook replay the refund.
 */
async function refund(s: Succeeded): Promise<WebhookOutcome> {
  const { ownerId, event, payment, booking, ctx, session } = s;
  const reason = booking.status === 'confirmed' ? 'duplicate_payment' : 'late_payment';

  if (booking.status === 'awaiting_payment') {
    // A hold that cannot be confirmed is over: expire it and free its slots.
    const expired = await Booking.updateOne(
      { ownerId, _id: booking._id, status: 'awaiting_payment' },
      { $set: { status: 'expired' } },
      { session },
    );
    if (expired.matchedCount !== 1) throw changedUnderneath();
    await SlotLock.deleteMany({ ownerId, bookingId: booking._id }, { session });
  }
  const paid = await Payment.updateOne(
    pendingOf(s),
    { $set: { status: 'succeeded', gatewayRef: event.gatewayRef } },
    { session },
  );
  if (paid.matchedCount !== 1) throw changedUnderneath();
  const [row] = await Refund.create(
    [
      {
        ownerId,
        venueId: booking.venueId,
        bookingId: booking._id,
        paymentId: payment._id,
        amount: event.amount,
        currency: payment.currency,
        reason,
        gateway: payment.gateway ?? ctx.gateway.key,
        gatewayAccountId: payment.gatewayAccountId,
        status: 'pending',
        by: null,
      },
    ],
    { session },
  );
  await logSystemActivity(
    ownerId,
    {
      action: 'payment.refund',
      entity: 'payment',
      entityId: String(payment._id),
      venueId: String(booking.venueId),
      after: { bookingId: String(booking._id), refundId: String(row!._id), amount: event.amount, reason, status: 'pending' },
    },
    ctx.now,
    session,
  );

  let result: Awaited<ReturnType<PaymentGateway['refund']>>;
  try {
    result = await ctx.gateway.refund(ctx.creds, {
      gatewayRef: event.gatewayRef,
      amount: event.amount,
      idempotencyKey: `refund_${String(payment._id)}`,
    });
  } catch {
    // Not a GatewayError: the route must answer 500 so the gateway retries the webhook.
    throw new Error('Refund failed while applying a webhook');
  }

  // Only the outcome remains; a declined refund stays on record (status failed) for staff to settle.
  await Refund.updateOne({ ownerId, _id: row!._id }, { $set: { status: result.status, gatewayRef: result.refundRef } }, { session });
  await ActivityLog.updateOne(
    { ownerId, entityId: payment._id, action: 'payment.refund', 'after.refundId': String(row!._id) },
    { $set: { 'after.status': result.status } },
    { session },
  );
  if (result.status !== 'failed') {
    await Payment.updateOne({ ownerId, _id: payment._id }, { $set: { refundedAmount: event.amount } }, { session });
  }
  return 'applied';
}
