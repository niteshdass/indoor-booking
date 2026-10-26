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
 * the partial unique index says it is already there. A pending payment of the other kind (a
 * walk-in link under an online intent, or the reverse) is a 409.
 */
export async function pendingCardPayment(
  booking: BookingDoc,
  kind: 'intent' | 'link',
  fields: { amount: number; gateway: string; gatewayAccountId: string; groupId?: unknown },
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
    const existing = await Payment.findOne({ ownerId, bookingId: booking._id, method: 'card', status: 'pending' });
    if (!existing) throw err;
    if (existing.kind !== kind) {
      throw new AppError(409, 'invalid_transition', 'This booking already has a payment in progress');
    }
    return existing;
  }
}

/**
 * Creates (or re-reads) the PaymentIntent for the booking's outstanding advance. A booking of a
 * multi-day group pays for every held day of the group at once: one intent for the sum, one
 * pending payment per booking, the intent's metadata naming the first.
 */
export async function startIntent(
  booking: BookingDoc,
  ctx: { config: Config; services: AppServices },
): Promise<{ payment: PaymentDoc; amount: number; clientSecret: string; publishableKey: string }> {
  const { config, services } = ctx;
  const ownerId = String(booking.ownerId);
  const now = services.now();
  const held = booking.groupId
    ? await Booking.find({ ownerId, groupId: booking.groupId, playerId: booking.playerId, status: 'awaiting_payment' }).sort({ startAt: 1 })
    : [booking];
  // The days of a group share one hold, so one lapsed day means they all have.
  if (held.length === 0 || held.some((b) => !b.holdExpiresAt || b.holdExpiresAt <= now)) {
    for (const b of held) await expireHold(b, now);
    throw new AppError(409, 'hold_expired', 'This hold has expired');
  }

  const loaded = await loadGateway(ownerId, 'stripe', config, services);
  const venue = await Venue.findOne({ ownerId, _id: booking.venueId });
  if (!loaded || !loaded.row.enabled || !venue || !loaded.gateway.supports(venue.country, booking.currency)) {
    throw paymentsUnavailable();
  }
  const { row, creds, gateway } = loaded;

  const owing = held.filter((b) => b.advanceRequired - b.amountPaid >= 1);
  if (owing.length === 0) throw paymentsUnavailable();
  const payments: PaymentDoc[] = [];
  for (const b of owing) {
    payments.push(
      await pendingCardPayment(b, 'intent', {
        amount: b.advanceRequired - b.amountPaid,
        gateway: gateway.key,
        gatewayAccountId: row.accountId,
        ...(b.groupId ? { groupId: b.groupId } : {}),
      }),
    );
  }
  const lead = payments[0]!;
  const leadBooking = owing[0]!;
  const amount = payments.reduce((n, p) => n + p.amount, 0);

  const created = await gateway.createPayment(creds, {
    kind: 'intent',
    amount,
    currency: lead.currency,
    metadata: {
      paymentId: String(lead._id),
      bookingId: String(leadBooking._id),
      ownerId,
      reference: leadBooking.reference,
      ...(leadBooking.groupId ? { groupId: String(leadBooking.groupId) } : {}),
    },
    description:
      owing.length > 1 ? `Bookings ${owing.map((b) => b.reference).join(', ')}` : `Booking ${leadBooking.reference}`,
    idempotencyKey: `intent_${lead._id}`,
  });
  if (!created.clientSecret || !created.gatewayRef) throw new GatewayError('gateway_error');
  const unset = payments.filter((p) => p.gatewayRef !== created.gatewayRef);
  if (unset.length > 0) {
    await Payment.updateMany({ ownerId, _id: { $in: unset.map((p) => p._id) } }, { $set: { gatewayRef: created.gatewayRef } });
    for (const p of unset) p.gatewayRef = created.gatewayRef;
  }
  return { payment: lead, amount, clientSecret: created.clientSecret, publishableKey: row.publishableKey };
}

/** Creates (or, by idempotency key, replays) the Checkout Session of a pending walk-in `link` payment. */
export async function startLink(
  booking: BookingDoc,
  payment: PaymentDoc,
  ctx: { config: Config; services: AppServices },
): Promise<{ url: string }> {
  const { config, services } = ctx;
  const ownerId = String(booking.ownerId);
  const loaded = await loadGateway(ownerId, payment.gateway ?? '', config, services);
  // The webhook verifies with the account that took the payment, so the link must be on it too.
  if (!loaded || loaded.row.accountId !== payment.gatewayAccountId || !booking.holdExpiresAt) {
    throw paymentsUnavailable();
  }
  const { creds, gateway } = loaded;

  const created = await gateway.createPayment(creds, {
    kind: 'link',
    amount: payment.amount,
    currency: payment.currency,
    metadata: {
      paymentId: String(payment._id),
      bookingId: String(booking._id),
      ownerId,
      reference: booking.reference,
    },
    description: `Booking ${booking.reference}`,
    idempotencyKey: `link_${payment._id}`,
    expiresAt: booking.holdExpiresAt,
    successUrl: `${config.appUrl}/payment-complete?reference=${encodeURIComponent(booking.reference)}`,
  });
  if (!created.url || !created.linkRef) throw new GatewayError('gateway_error');
  if (payment.linkRef !== created.linkRef) {
    await Payment.updateOne({ ownerId, _id: payment._id }, { $set: { linkRef: created.linkRef } });
    payment.linkRef = created.linkRef;
  }
  return { url: created.url };
}
