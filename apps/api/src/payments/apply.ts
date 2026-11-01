import mongoose, { type ClientSession } from 'mongoose';
import { bookingPaymentStatus, paymentStatusFor, type AddonLine } from '@booking/shared';
import { lockAddon } from '../addons/guards';
import { offeredAddons } from '../addons/offered';
import { Booking, holdingFilter, type BookingDoc } from '../bookings/booking.model';
import { expireStaleHolds, limited, stockInUse } from '../bookings/create';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import { noticeBooking } from '../notifications/outbox';
import { logSystemActivity } from '../tenancy/activityLog.model';
import { lockTurf } from '../venues/guards';
import { Turf } from '../venues/turf.model';
import { Venue } from '../venues/venue.model';
import type { GatewayEvent } from './gateway';
import { Refund } from './refund.model';
import { reserveRefunds, settleRefund } from './refunds';
import type { WebhookOutcome } from './webhookEvent.model';

export type ApplyContext = { now: Date };

export type ApplyResult = { outcome: WebhookOutcome; refundIds: string[] };

const done = (outcome: WebhookOutcome, refundIds: string[] = []): ApplyResult => ({ outcome, refundIds });

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
): Promise<ApplyResult> {
  if (event.kind === 'ignored') return done('ignored');
  if (event.kind === 'refund_updated') return done(await refundUpdated(ownerId, event, ctx, session));
  if (event.kind === 'charge_refunded') return done(await chargeRefunded(ownerId, event, ctx, session));
  if (event.kind === 'dispute') return done(await disputeChanged(ownerId, event, ctx, session));
  const payment =
    event.paymentId && mongoose.isValidObjectId(event.paymentId)
      ? await Payment.findOne({ ownerId, _id: event.paymentId }).session(session)
      : null;
  if (!payment) return done('unmatched');
  const pending = { ownerId, _id: payment._id, status: 'pending' };

  if (event.kind === 'attempt_failed') {
    const res = await Payment.updateOne(pending, { $set: { failureCode: event.failureCode } }, { session });
    return done(res.matchedCount === 1 ? 'applied' : 'ignored');
  }
  // A multi-day group's rows share the intent, so they close together.
  const together = payment.groupId ? { ownerId, groupId: payment.groupId, method: 'card', status: 'pending' } : pending;
  if (event.kind === 'closed') {
    const res = await Payment.updateMany(together, { $set: { status: 'failed' } }, { session });
    return done(res.matchedCount > 0 ? 'applied' : 'ignored');
  }

  if (payment.status !== 'pending') return done('ignored');
  const booking = await Booking.findOne({ ownerId, _id: payment.bookingId }).session(session);
  const others = payment.groupId
    ? await Payment.find({ ...together, _id: { $ne: payment._id } }).sort({ _id: 1 }).session(session)
    : [];
  const expected = others.reduce((n, p) => n + p.amount, payment.amount);
  if (event.amount !== expected || event.currency !== payment.currency) {
    if (others.length > 0) {
      const failed = await Payment.updateMany(
        { ownerId, _id: { $in: others.map((p) => p._id) }, status: 'pending' },
        { $set: { status: 'failed', failureCode: 'amount_mismatch' } },
        { session },
      );
      if (failed.matchedCount !== others.length) throw changedUnderneath();
    }
    return mismatch({ ownerId, event, payment, booking, ctx, session });
  }
  if (!booking) return done('ignored');
  const days: { payment: PaymentDoc; booking: BookingDoc }[] = [];
  for (const p of others) {
    const day = await Booking.findOne({ ownerId, _id: p.bookingId }).session(session);
    if (!day) throw changedUnderneath();
    days.push({ payment: p, booking: day });
  }
  // A group can span turfs: lock each, always in the same order.
  const turfIds = [...new Set([booking, ...days.map((d) => d.booking)].map((b) => String(b.turfId)))].sort();
  for (const id of turfIds) await lockTurf({ ownerId }, id, ctx.now, session);

  // Each booking of a group is settled on its own: confirmed while it still can be, refunded otherwise.
  const refundIds: string[] = [];
  for (const d of days) {
    refundIds.push(...(await settle({ ownerId, event, payment: d.payment, booking: d.booking, ctx, session })).refundIds);
  }
  const lead = await settle({ ownerId, event, payment, booking, ctx, session });
  return done(lead.outcome, [...lead.refundIds, ...refundIds]);
}

/** Confirms or revives the booking the payment is for, or refunds the payment when it cannot. */
async function settle(succeeded: Succeeded): Promise<ApplyResult> {
  const { ownerId, booking, ctx, session } = succeeded;
  const holding = booking.status === 'awaiting_payment' && booking.holdExpiresAt != null && booking.holdExpiresAt > ctx.now;
  // A live hold still has its slots and stock, even once a walk-in's in-progress slot has ended;
  // a lapsed or expired one gets them back only if nobody took them and the slot is not over.
  if (holding) return done(await confirm(succeeded));
  const lapsed = booking.status === 'awaiting_payment' && !holding;
  if ((lapsed || booking.status === 'expired') && (await stillFree(ownerId, booking, ctx.now, session))) {
    return done(await confirm(succeeded));
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

/** The gateway took a different amount or currency than the payment asked for: fail it and give the money back. */
async function mismatch(s: Omit<Succeeded, 'booking'> & { booking: BookingDoc | null }): Promise<ApplyResult> {
  const { ownerId, event, payment, booking, ctx, session } = s;
  const failed = await Payment.updateOne(
    pendingOf(s),
    { $set: { status: 'failed', failureCode: 'amount_mismatch', gatewayRef: event.gatewayRef } },
    { session },
  );
  if (failed.matchedCount !== 1) throw changedUnderneath();
  if (!booking) {
    // Nothing to attach a refund to; staff will see the failed payment and this log.
    console.error(`[payments] mismatched payment ${String(payment._id)} has no booking; not refunded`);
    return done('mismatch');
  }
  const [row] = await reserveRefunds(
    {
      booking,
      parts: [{ paymentId: payment._id, method: 'card', amount: event.amount }],
      reason: 'amount_mismatch',
      ruleApplied: null,
      by: null,
      now: ctx.now,
      currency: event.currency,
    },
    session,
  );
  await logSystemActivity(
    ownerId,
    {
      action: 'payment.mismatch',
      entity: 'payment',
      entityId: String(payment._id),
      venueId: String(booking.venueId),
      after: {
        expected: { amount: payment.amount, currency: payment.currency },
        received: { amount: event.amount, currency: event.currency },
      },
    },
    ctx.now,
    session,
  );
  return done('mismatch', [String(row!._id)]);
}

/** A gateway report on a refund we recorded; a failure releases (or, after the fact, reverses) its reservation. */
async function refundUpdated(
  ownerId: string,
  event: Extract<GatewayEvent, { kind: 'refund_updated' }>,
  ctx: ApplyContext,
  session: ClientSession,
): Promise<WebhookOutcome> {
  const row = await Refund.findOne({ ownerId, gatewayRef: event.refundRef }).session(session);
  if (!row) return 'unmatched';
  if (event.status === 'succeeded' && row.status === 'failed') {
    // The money moved after we gave up on it: leave the row alone, but make sure staff can see it.
    console.error(`[refunds] refund ${String(row._id)} succeeded at the gateway after being recorded as failed`);
    await logSystemActivity(
      ownerId,
      {
        action: 'refund.late_success',
        entity: 'refund',
        entityId: String(row._id),
        venueId: String(row.venueId),
        after: { refundRef: event.refundRef, failureCode: row.failureCode },
      },
      ctx.now,
      session,
    );
    return 'applied';
  }
  const changed = await settleRefund(
    ownerId,
    row._id,
    { status: event.status, failureCode: event.failureCode, allowFromSucceeded: event.status === 'failed' },
    ctx.now,
    session,
  );
  return changed ? 'applied' : 'ignored';
}

/**
 * The card payments that took PaymentIntent `gatewayRef` (a multi-day group's rows share one), newest
 * first; none when the intent is not this owner's or came from the other mode.
 */
async function paymentsOfIntent(ownerId: string, gatewayRef: string | null, livemode: boolean, session: ClientSession) {
  if (!gatewayRef) return [];
  const rows = await Payment.find({ ownerId, gatewayRef, method: 'card', status: 'succeeded' }).sort({ _id: -1 }).session(session);
  const mode = livemode ? 'live' : 'test';
  return rows.some((p) => p.gatewayMode != null && p.gatewayMode !== mode) ? [] : rows;
}

/**
 * Records refunds made in the gateway's dashboard. The charge reports its refunded total, and every
 * refund the app makes is reserved on its payment before the gateway hears of it, so whatever the
 * total holds beyond the payments' reservations was refunded outside the app. It is split over the
 * payments newest first and recorded as settled `external` refunds, which also count on the booking.
 */
async function chargeRefunded(
  ownerId: string,
  event: Extract<GatewayEvent, { kind: 'charge_refunded' }>,
  ctx: ApplyContext,
  session: ClientSession,
): Promise<WebhookOutcome> {
  const payments = await paymentsOfIntent(ownerId, event.gatewayRef, event.livemode, session);
  if (payments.length === 0) return 'unmatched';
  if (payments.some((p) => p.currency !== event.currency)) return 'mismatch';
  let left = event.amountRefunded - payments.reduce((n, p) => n + p.refundedAmount, 0);
  if (left <= 0) return 'ignored';
  for (const payment of payments) {
    const take = Math.min(left, payment.amount - payment.refundedAmount);
    if (take <= 0) continue;
    left -= take;
    const booking = await Booking.findOne({ ownerId, _id: payment.bookingId }).session(session);
    if (!booking) throw changedUnderneath();
    const [row] = await reserveRefunds(
      { booking, parts: [{ paymentId: payment._id, method: 'card', amount: take }], reason: 'external', ruleApplied: null, by: null, now: ctx.now },
      session,
    );
    // Settled in the same transaction, so no dispatcher ever sees it pending and sends it again.
    if (!(await settleRefund(ownerId, row!._id, { status: 'succeeded' }, ctx.now, session))) throw changedUnderneath();
    // An excess payment was never in amountPaid, so its refund is not taken off the booking either.
    if (!payment.excess) {
      const fresh = await Booking.findOneAndUpdate(
        { ownerId, _id: booking._id },
        { $inc: { amountRefunded: take } },
        { session, new: true },
      );
      await Booking.updateOne(
        { ownerId, _id: booking._id },
        { $set: { paymentStatus: bookingPaymentStatus(fresh!.amountPaid, fresh!.amountRefunded, fresh!.total) } },
        { session },
      );
    }
    await noticeBooking('staff_refund_external', booking, ctx.now, session, { amount: take, refundId: String(row!._id) });
  }
  // More than the payments took (a mismatched charge's extra): nothing left to hang it on.
  if (left > 0) console.error(`[refunds] ${left} refunded at the gateway on ${event.gatewayRef} beyond what its payments took`);
  return 'applied';
}

/** Flags the bookings a disputed charge paid for and tells staff when a dispute opens or closes. */
async function disputeChanged(
  ownerId: string,
  event: Extract<GatewayEvent, { kind: 'dispute' }>,
  ctx: ApplyContext,
  session: ClientSession,
): Promise<WebhookOutcome> {
  const payments = await paymentsOfIntent(ownerId, event.gatewayRef, event.livemode, session);
  if (payments.length === 0) return 'unmatched';
  const fields = { ref: event.disputeRef, amount: event.amount, currency: event.currency, reason: event.reason };
  let changed = false;
  for (const bookingId of [...new Set(payments.map((p) => String(p.bookingId)))]) {
    const res =
      event.status === 'open'
        ? // A repeat of this dispute's opening changes nothing; a new dispute replaces a closed one.
          await Booking.updateOne(
            { ownerId, _id: bookingId, 'dispute.ref': { $ne: event.disputeRef } },
            { $set: { dispute: { ...fields, status: 'open', openedAt: ctx.now, closedAt: null } } },
            { session },
          )
        : // Closes the open one; a close whose opening never arrived records the dispute as closed.
          await Booking.updateOne(
            {
              ownerId,
              _id: bookingId,
              $or: [{ dispute: null }, { 'dispute.ref': event.disputeRef, 'dispute.status': 'open' }],
            },
            [
              {
                $set: {
                  dispute: {
                    ...fields,
                    status: event.status,
                    openedAt: { $cond: [{ $eq: ['$dispute.ref', event.disputeRef] }, '$dispute.openedAt', null] },
                    closedAt: ctx.now,
                  },
                },
              },
            ],
            { session },
          );
    if (res.modifiedCount !== 1) continue;
    changed = true;
    const booking = (await Booking.findOne({ ownerId, _id: bookingId }).session(session))!;
    await logSystemActivity(
      ownerId,
      {
        action: event.status === 'open' ? 'booking.dispute_opened' : 'booking.dispute_closed',
        entity: 'booking',
        entityId: bookingId,
        venueId: String(booking.venueId),
        after: { disputeRef: event.disputeRef, status: event.status, amount: event.amount, reason: event.reason },
      },
      ctx.now,
      session,
    );
    await noticeBooking(event.status === 'open' ? 'staff_dispute_opened' : 'staff_dispute_closed', booking, ctx.now, session, {
      amount: event.amount,
      ...(event.status === 'open' ? {} : { reason: event.status }),
      disputeRef: event.disputeRef,
    });
  }
  return changed ? 'applied' : 'ignored';
}

const pendingOf = (s: Pick<Succeeded, 'ownerId' | 'payment'>) => ({ ownerId: s.ownerId, _id: s.payment._id, status: 'pending' });

/** Whether an expired or lapsed booking can have its slots and stock-limited add-ons back. */
export async function stillFree(ownerId: string, booking: BookingDoc, now: Date, session: ClientSession): Promise<boolean> {
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
  // One at a time: a transaction session cannot run operations in parallel.
  const venue = await Venue.findOne({ ownerId, _id: booking.venueId }).session(session);
  const turf = await Turf.findOne({ ownerId, _id: booking.turfId }).session(session);
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
  const amountPaid = booking.amountPaid + payment.amount;
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
      after: { status: 'confirmed', via: 'payment', paymentId: String(payment._id), amount: payment.amount },
    },
    ctx.now,
    session,
  );
  const confirmedNow = await Booking.findOne({ ownerId, _id: booking._id }).session(session);
  await noticeBooking('booking_confirmed', confirmedNow!, ctx.now, session);
  return 'applied';
}

/**
 * Refunds a payment its booking can no longer use. Only records the decision: the refund is
 * reserved pending here and sent to the gateway by the webhook route once this transaction commits.
 */
async function refund(s: Succeeded): Promise<ApplyResult> {
  const { ownerId, event, payment, booking, ctx, session } = s;
  const reason = ['confirmed', 'completed', 'no_show'].includes(booking.status) ? 'duplicate_payment' : 'late_payment';

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
    { $set: { status: 'succeeded', gatewayRef: event.gatewayRef, excess: true } },
    { session },
  );
  if (paid.matchedCount !== 1) throw changedUnderneath();
  // Excess, so no allocation offers it, even once a failed refund releases its reservation.
  const [row] = await reserveRefunds(
    {
      booking,
      parts: [{ paymentId: payment._id, method: 'card', amount: payment.amount }],
      reason,
      ruleApplied: null,
      by: null,
      now: ctx.now,
    },
    session,
  );
  return done('applied', [String(row!._id)]);
}
