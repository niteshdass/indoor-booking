import type { Config } from '../config';
import { isDuplicateKeyError, runInTransaction } from '../db';
import { AppError } from '../errors';
import type { BookingDoc } from '../bookings/booking.model';
import { Booking } from '../bookings/booking.model';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import type { AppServices } from '../services';
import { Venue } from '../venues/venue.model';
import { GatewayError } from './gateway';
import { loadGateway } from './gateway.model';

export const paymentsUnavailable = () =>
  new AppError(409, 'payments_unavailable', 'Online payment is not available for this booking');

/** Moves a lapsed hold to `expired` and frees its slots, in one transaction. A no-op if it was just settled. */
export async function expireHold(booking: BookingDoc, now: Date): Promise<void> {
  const ownerId = String(booking.ownerId);
  await runInTransaction(async (session) => {
    const res = await Booking.updateOne(
      { ownerId, _id: booking._id, status: 'awaiting_payment', holdExpiresAt: { $lte: now } },
      { $set: { status: 'expired' } },
      { session },
    );
    if (res.modifiedCount === 1) await SlotLock.deleteMany({ ownerId, bookingId: booking._id }, { session });
  });
}

/**
 * Inserts the booking's pending card payment, or returns the existing one of the same kind when
 * the partial unique index says it is already there.
 */
export async function pendingCardPayment(
  booking: BookingDoc,
  kind: 'intent' | 'link',
  fields: { amount: number; gateway: string; gatewayAccountId: string },
): Promise<PaymentDoc> {
  const ownerId = String(booking.ownerId);
  try {
    return await Payment.create({
      ownerId,
      venueId: booking.venueId,
      bookingId: booking._id,
      method: 'card',
      kind,
      status: 'pending',
      currency: booking.currency,
      ...fields,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await Payment.findOne({ ownerId, bookingId: booking._id, method: 'card', status: 'pending', kind });
    if (!existing) throw err;
    return existing;
  }
}

/** Creates (or re-reads) the PaymentIntent for the booking's outstanding advance. */
export async function startIntent(
  booking: BookingDoc,
  ctx: { config: Config; services: AppServices },
): Promise<{ payment: PaymentDoc; clientSecret: string; publishableKey: string }> {
  const { config, services } = ctx;
  const ownerId = String(booking.ownerId);
  const now = services.now();
  if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) {
    await expireHold(booking, now);
    throw new AppError(409, 'hold_expired', 'This hold has expired');
  }

  const loaded = await loadGateway(ownerId, 'stripe', config, services);
  const venue = await Venue.findOne({ ownerId, _id: booking.venueId });
  if (!loaded || !loaded.row.enabled || !venue || !loaded.gateway.supports(venue.country, booking.currency)) {
    throw paymentsUnavailable();
  }
  const { row, creds, gateway } = loaded;

  const outstanding = booking.advanceRequired - booking.amountPaid;
  if (outstanding < 1) throw paymentsUnavailable();
  const payment = await pendingCardPayment(booking, 'intent', {
    amount: outstanding,
    gateway: gateway.key,
    gatewayAccountId: row.accountId,
  });

  const created = await gateway.createPayment(creds, {
    kind: 'intent',
    amount: payment.amount,
    currency: payment.currency,
    metadata: {
      paymentId: String(payment._id),
      bookingId: String(booking._id),
      ownerId,
      reference: booking.reference,
    },
    description: `Booking ${booking.reference}`,
    idempotencyKey: `intent_${payment._id}`,
  });
  if (!created.clientSecret || !created.gatewayRef) throw new GatewayError('gateway_error');
  if (payment.gatewayRef !== created.gatewayRef) {
    await Payment.updateOne({ ownerId, _id: payment._id }, { $set: { gatewayRef: created.gatewayRef } });
    payment.gatewayRef = created.gatewayRef;
  }
  return { payment, clientSecret: created.clientSecret, publishableKey: row.publishableKey };
}
