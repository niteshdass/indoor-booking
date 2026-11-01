import type { Config } from '../config';
import { isDuplicateKeyError, runInTransaction } from '../db';
import { AppError } from '../errors';
import type { BookingDoc } from '../bookings/booking.model';
import { Booking } from '../bookings/booking.model';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import type { AppServices } from '../services';
import { User } from '../auth/user.model';
import { effectiveForVenue } from '../venues/effective';
import { Venue } from '../venues/venue.model';
import { GatewayError } from './gateway';
import { loadGateway, type GatewayMode } from './gateway.model';
import { gatewayUsable } from './methods';

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
  fields: { amount: number; gateway: string; gatewayAccountId: string; gatewayMode: GatewayMode; groupId?: unknown },
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

export type CheckoutStart = { payment: PaymentDoc; amount: number } & (
  | { gateway: 'stripe'; clientSecret: string; publishableKey: string }
  | { gateway: 'sslcommerz'; url: string }
);

const paymentInProgress = () =>
  new AppError(409, 'payment_in_progress', 'A payment for this booking is already in progress; finish it or wait for it to expire');

/**
 * A pending card payment of the hold made on another gateway is retired before a new one starts:
 * cancelled there first, so it can no longer take money. A gateway that cannot promise that (a
 * hosted session may still be paid) keeps the payment, and the player is told to finish it.
 */
async function retireOtherGateway(held: BookingDoc[], key: string, ctx: { config: Config; services: AppServices }): Promise<void> {
  const ownerId = String(held[0]!.ownerId);
  const others = await Payment.find({
    ownerId,
    bookingId: { $in: held.map((b) => b._id) },
    method: 'card',
    kind: 'intent',
    status: 'pending',
    gateway: { $ne: key },
  });
  const cancelled = new Set<string>();
  for (const p of others) {
    const loaded = await loadGateway(ownerId, p.gateway ?? '', ctx.config, ctx.services, { mode: p.gatewayMode as GatewayMode | null });
    if (!loaded || loaded.gateway.hosted) throw paymentInProgress();
    const ref = p.gatewayRef ?? '';
    if (!cancelled.has(ref)) {
      try {
        await loaded.gateway.cancelPayment(loaded.creds, { kind: 'intent', paymentId: String(p._id), gatewayRef: p.gatewayRef ?? null, linkRef: p.linkRef ?? null });
      } catch {
        throw paymentInProgress();
      }
      cancelled.add(ref);
    }
    await Payment.updateOne({ ownerId, _id: p._id, status: 'pending' }, { $set: { status: 'failed', failureCode: 'superseded' } });
  }
}

/**
 * Starts (or re-reads) the online payment of the booking's outstanding advance on gateway `key`:
 * a Stripe PaymentIntent for the in-app element, or an SSLCommerz session to send the player to.
 * A booking of a multi-day group pays for every held day of the group at once: one gateway payment
 * for the sum, one pending payment per booking, the gateway's reference naming the first.
 */
export async function startCheckout(
  booking: BookingDoc,
  key: 'stripe' | 'sslcommerz',
  ctx: { config: Config; services: AppServices },
): Promise<CheckoutStart> {
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

  const loaded = await loadGateway(ownerId, key, config, services);
  const venue = await Venue.findOne({ ownerId, _id: booking.venueId });
  // The venue's own switch counts too: an owner can offer a gateway at one venue and not another.
  const offered = venue ? (await effectiveForVenue(ownerId, venue)).paymentMethods.gateways.includes(key) : false;
  if (!venue || !offered || !gatewayUsable(loaded, venue.country, booking.currency)) {
    throw paymentsUnavailable();
  }
  const { creds, gateway } = loaded;
  await retireOtherGateway(held, key, ctx);

  const owing = held.filter((b) => b.advanceRequired - b.amountPaid >= 1);
  if (owing.length === 0) throw paymentsUnavailable();
  const payments: PaymentDoc[] = [];
  for (const b of owing) {
    payments.push(
      await pendingCardPayment(b, 'intent', {
        amount: b.advanceRequired - b.amountPaid,
        gateway: gateway.key,
        gatewayAccountId: loaded.accountId,
        gatewayMode: loaded.mode,
        ...(b.groupId ? { groupId: b.groupId } : {}),
      }),
    );
  }
  // A row from another gateway that slipped in between the retire and the insert.
  if (payments.some((p) => p.gateway !== gateway.key)) throw paymentInProgress();
  const lead = payments[0]!;
  const leadBooking = owing[0]!;
  const amount = payments.reduce((n, p) => n + p.amount, 0);
  const description =
    owing.length > 1 ? `Bookings ${owing.map((b) => b.reference).join(', ')}` : `Booking ${leadBooking.reference}`;
  const metadata = {
    paymentId: String(lead._id),
    bookingId: String(leadBooking._id),
    ownerId,
    reference: leadBooking.reference,
    ...(leadBooking.groupId ? { groupId: String(leadBooking.groupId) } : {}),
  };

  if (gateway.key === 'sslcommerz') {
    // The open session is reused, so two tabs cannot pay twice; after a failed attempt a new one is opened.
    if (lead.linkUrl && !lead.failureCode) return { gateway: 'sslcommerz', payment: lead, amount, url: lead.linkUrl };
    const player = booking.playerId ? await User.findById(booking.playerId) : null;
    const created = await gateway.createPayment(creds, {
      kind: 'intent',
      amount,
      currency: lead.currency,
      metadata,
      description,
      idempotencyKey: `intent_${lead._id}`,
      returnUrl: `${config.apiUrl}/api/v1/webhooks/sslcommerz/${ownerId}/return?booking=${encodeURIComponent(String(booking._id))}`,
      notifyUrl: `${config.apiUrl}/api/v1/webhooks/sslcommerz/${ownerId}`,
      customer: {
        name: player?.name || booking.guest?.name || 'Customer',
        email: player?.email ?? null,
        phone: player?.phone ?? booking.guest?.phone ?? null,
      },
    });
    if (!created.url || !created.linkRef) throw new GatewayError('gateway_error');
    await Payment.updateMany(
      { ownerId, _id: { $in: payments.map((p) => p._id) }, status: 'pending' },
      { $set: { linkRef: created.linkRef, linkUrl: created.url, linkOpenedAt: now, failureCode: null } },
    );
    return { gateway: 'sslcommerz', payment: lead, amount, url: created.url };
  }

  const created = await gateway.createPayment(creds, {
    kind: 'intent',
    amount,
    currency: lead.currency,
    metadata,
    description,
    idempotencyKey: `intent_${lead._id}`,
  });
  if (!created.clientSecret || !created.gatewayRef || !loaded.publishableKey) throw new GatewayError('gateway_error');
  const unset = payments.filter((p) => p.gatewayRef !== created.gatewayRef);
  if (unset.length > 0) {
    await Payment.updateMany({ ownerId, _id: { $in: unset.map((p) => p._id) } }, { $set: { gatewayRef: created.gatewayRef } });
    for (const p of unset) p.gatewayRef = created.gatewayRef;
  }
  return { gateway: 'stripe', payment: lead, amount, clientSecret: created.clientSecret, publishableKey: loaded.publishableKey };
}

/**
 * Creates (or, by idempotency key, replays) the Checkout Session of a pending walk-in `link` payment. The
 * rows of a walk-in group share one session for their sum, keyed and labelled by the group's first row.
 */
export async function startLink(
  booking: BookingDoc,
  payment: PaymentDoc,
  ctx: { config: Config; services: AppServices },
): Promise<{ url: string; amount: number }> {
  const { config, services } = ctx;
  const ownerId = String(booking.ownerId);
  const loaded = await loadGateway(ownerId, payment.gateway ?? '', config, services, { mode: payment.gatewayMode as GatewayMode | null });
  // The webhook verifies with the account that took the payment, so the link must be on it too.
  if (!loaded || loaded.accountId !== payment.gatewayAccountId || !booking.holdExpiresAt) {
    throw paymentsUnavailable();
  }
  const { creds, gateway } = loaded;
  const rows = payment.groupId
    ? await Payment.find({ ownerId, groupId: payment.groupId, method: 'card', kind: 'link', status: 'pending' }).sort({ _id: 1 })
    : [payment];
  if (rows.length === 0) throw paymentsUnavailable();
  const lead = rows[0]!;
  const leadBooking = String(lead.bookingId) === String(booking._id) ? booking : await Booking.findOne({ ownerId, _id: lead.bookingId });
  if (!leadBooking) throw paymentsUnavailable();
  const references = rows.length > 1
    ? (await Booking.find({ ownerId, _id: { $in: rows.map((p) => p.bookingId) } }).sort({ startAt: 1 })).map((b) => b.reference)
    : [leadBooking.reference];
  const amount = rows.reduce((n, p) => n + p.amount, 0);

  const created = await gateway.createPayment(creds, {
    kind: 'link',
    amount,
    currency: lead.currency,
    metadata: {
      paymentId: String(lead._id),
      bookingId: String(leadBooking._id),
      ownerId,
      reference: leadBooking.reference,
      ...(lead.groupId ? { groupId: String(lead.groupId) } : {}),
    },
    description: references.length > 1 ? `Bookings ${references.join(', ')}` : `Booking ${leadBooking.reference}`,
    idempotencyKey: `link_${lead._id}`,
    expiresAt: booking.holdExpiresAt,
    successUrl: `${config.appUrl}/payment-complete?reference=${encodeURIComponent(leadBooking.reference)}`,
  });
  if (!created.url || !created.linkRef) throw new GatewayError('gateway_error');
  const unset = rows.filter((p) => p.linkRef !== created.linkRef);
  if (unset.length > 0) {
    await Payment.updateMany({ ownerId, _id: { $in: unset.map((p) => p._id) } }, { $set: { linkRef: created.linkRef } });
    for (const p of unset) p.linkRef = created.linkRef;
  }
  if (payment.linkRef !== created.linkRef) payment.linkRef = created.linkRef;
  return { url: created.url, amount };
}
