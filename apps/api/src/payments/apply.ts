import mongoose, { type ClientSession } from 'mongoose';
import { paymentStatusFor } from '@booking/shared';
import { Booking } from '../bookings/booking.model';
import { Payment } from '../bookings/payment.model';
import { logSystemActivity } from '../tenancy/activityLog.model';
import { lockTurf } from '../venues/guards';
import type { GatewayCredentials, GatewayEvent, PaymentGateway } from './gateway';
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

  // Confirm: a hold, lapsed or not, keeps its slot locks until someone else books over it.
  if (booking.status !== 'awaiting_payment' || booking.endAt <= ctx.now) return 'ignored';

  const paid = await Payment.updateOne(
    pending,
    { $set: { status: 'succeeded', gatewayRef: event.gatewayRef } },
    { session },
  );
  const amountPaid = booking.amountPaid + event.amount;
  const confirmed = await Booking.updateOne(
    { ownerId, _id: booking._id, status: 'awaiting_payment', amountPaid: booking.amountPaid },
    {
      $set: { status: 'confirmed', amountPaid, paymentStatus: paymentStatusFor(amountPaid, booking.total), holdExpiresAt: null },
    },
    { session },
  );
  if (paid.matchedCount !== 1 || confirmed.matchedCount !== 1) throw changedUnderneath();

  await logSystemActivity(
    ownerId,
    {
      action: 'booking.confirmed',
      entity: 'booking',
      entityId: String(booking._id),
      venueId: String(booking.venueId),
      before: { status: 'awaiting_payment' },
      after: { status: 'confirmed', via: 'payment', paymentId: String(payment._id), amount: event.amount },
    },
    ctx.now,
    session,
  );
  return 'applied';
}
