import type { ClientSession } from 'mongoose';
import { normalizeTrxId, paymentStatusFor, type WalletProvider } from '@booking/shared';
import { normalizeBdMobile } from '../auth/normalize';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { keyHas } from '../bookings/create';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import { invalidTransition, transition, type Actor } from '../bookings/transition';
import { noticeBooking } from '../notifications/outbox';
import type { AppServices } from '../services';
import { logActivity, logSystemActivity } from '../tenancy/activityLog.model';
import type { TenantContext } from '../tenancy/context';
import { effectiveForVenue } from '../venues/effective';
import { lockTurf } from '../venues/guards';
import { Venue } from '../venues/venue.model';
import { stillFree } from './apply';
import { paymentsUnavailable } from './intent';
import { reserveRefunds } from './refunds';

/** Statuses a manual payment can be submitted for: a hold, live or lapsed, or one the sweep already expired. */
const PAYABLE = ['awaiting_payment', 'expired'];

/** The booking, or every booking of its group for the same player that a manual payment can still cover. */
export async function payableGroup(booking: BookingDoc): Promise<BookingDoc[]> {
  if (!booking.groupId) return [booking];
  return Booking.find({ ownerId: booking.ownerId, groupId: booking.groupId, playerId: booking.playerId, status: { $in: PAYABLE } }).sort({
    startAt: 1,
  });
}

export type ManualPaymentInput = { provider: WalletProvider; trxId: string; senderNumber: string };

/**
 * Records a wallet transfer the customer made outside the app, for staff to check. Covers the
 * booking, or every unpaid booking of its group for the same player: one pending `manual` payment
 * per booking still owing, the TrxID on the first (the lead) only. A live hold moves to pending; a
 * lapsed or expired one is revived as pending while its slots are free. When they are not, the
 * booking is left as it is and the payment still recorded (`slots_taken`), so staff can check it
 * and send the money back. Nothing counts in amountPaid until staff verify it.
 */
export async function submitManualPayment(
  booking: BookingDoc,
  input: ManualPaymentInput,
  ctx: { services: AppServices },
): Promise<{ bookings: BookingDoc[]; payment: PaymentDoc; outcome: 'pending' | 'slots_taken' }> {
  const ownerId = String(booking.ownerId);
  const now = ctx.services.now();
  const trxId = normalizeTrxId(input.trxId);
  if (!trxId) throw new AppError(400, 'invalid_trx_id', 'Enter the Transaction ID from your payment message');
  const senderNumber = normalizeBdMobile(input.senderNumber);
  if (!senderNumber) throw new AppError(400, 'invalid_sender', 'Use a Bangladesh mobile number, e.g. 01712345678');

  const venue = await Venue.findOne({ ownerId, _id: booking.venueId });
  const settings = venue ? await effectiveForVenue(ownerId, venue) : null;
  if (!settings?.paymentMethods.manualWallets.some((w) => w.provider === input.provider)) throw paymentsUnavailable();

  const group = await payableGroup(booking);
  // The booking itself too, though it may have moved on: a payment it already has is the clearer answer.
  const ids = [booking._id, ...group.filter((b) => String(b._id) !== String(booking._id)).map((b) => b._id)];
  // A group can span turfs: lock each, always in the same order.
  const turfIds = [...new Set([booking, ...group].map((b) => String(b.turfId)))].sort();
  const actor: Actor = { ownerId, userId: booking.playerId ? String(booking.playerId) : null };

  try {
    return await runInTransaction(async (session) => {
      for (const id of turfIds) await lockTurf({ ownerId }, id, now, session);
      if (await Payment.exists({ ownerId, bookingId: { $in: ids }, kind: 'manual', status: 'pending' }).session(session)) {
        throw new AppError(409, 'payment_submitted', 'A payment for this booking is already waiting to be checked');
      }
      const all = await Booking.find({ ownerId, _id: { $in: ids } }).sort({ startAt: 1 }).session(session);
      const self = all.find((b) => String(b._id) === String(booking._id));
      if (!self || !PAYABLE.includes(self.status)) throw invalidTransition(self?.status ?? booking.status);
      const bookings = all.filter((b) => PAYABLE.includes(b.status));
      const owing = bookings.filter((b) => b.advanceRequired - b.amountPaid >= 1);
      if (owing.length === 0) throw paymentsUnavailable();

      const payments: PaymentDoc[] = [];
      for (const b of owing) {
        const [p] = await Payment.create(
          [
            {
              ownerId,
              venueId: b.venueId,
              bookingId: b._id,
              method: 'wallet',
              kind: 'manual',
              status: 'pending',
              amount: b.advanceRequired - b.amountPaid,
              currency: b.currency,
              provider: input.provider,
              trxId: payments.length === 0 ? trxId : null,
              senderNumber,
              groupId: b.groupId ?? null,
              // The app clock: the player sees it as the time they submitted.
              createdAt: now,
            },
          ],
          { session },
        );
        payments.push(p as unknown as PaymentDoc);
      }

      // A group's days share one hold, so they all go to pending or none does.
      const live = bookings.every((b) => b.status === 'awaiting_payment' && b.holdExpiresAt != null && b.holdExpiresAt > now);
      let free = live;
      if (!live) {
        free = true;
        for (const b of bookings) {
          if (!(await stillFree(ownerId, b, now, session))) {
            free = false;
            break;
          }
        }
      }
      if (!free) return { bookings, payment: payments[0]!, outcome: 'slots_taken' as const };

      const moved: BookingDoc[] = [];
      for (const b of bookings) {
        moved.push(
          b.status === 'expired'
            ? await revive(actor, b, payments[0]!, now, session)
            : await transition(actor, b, 'pending', now, session, { holdExpiresAt: null }, { via: 'manual_payment' }),
        );
      }
      return { bookings: moved, payment: payments[0]!, outcome: 'pending' as const };
    });
  } catch (err) {
    if (keyHas(err, 'trxId')) {
      throw new AppError(409, 'trx_id_used', 'This Transaction ID was already used');
    }
    throw err;
  }
}

/**
 * Revives an expired booking as pending by taking its slot locks back, as apply.ts confirm() does
 * for a paid one. Bypasses BOOKING_TRANSITIONS on purpose: expired stays terminal for staff.
 */
async function revive(t: Actor, booking: BookingDoc, payment: PaymentDoc, now: Date, session: ClientSession): Promise<BookingDoc> {
  const { ownerId } = t;
  await SlotLock.create(
    booking.slots.map((slot) => ({ ownerId, turfId: booking.turfId, startAt: slot.startAt, bookingId: booking._id })),
    { session, ordered: true },
  );
  const revived = await Booking.findOneAndUpdate(
    { ownerId, _id: booking._id, status: 'expired' },
    { $set: { status: 'pending', holdExpiresAt: null } },
    { session, new: true },
  );
  if (!revived) throw invalidTransition(booking.status);
  const entry = {
    action: 'booking.revived',
    entity: 'booking',
    entityId: String(booking._id),
    venueId: String(booking.venueId),
    before: { status: 'expired' },
    after: { status: 'pending', via: 'manual_payment', paymentId: String(payment._id) },
  };
  if (t.userId) await logActivity({ ownerId, userId: t.userId }, entry, now, session);
  else await logSystemActivity(ownerId, entry, now, session);
  return revived;
}

const nothingToCheck = () => new AppError(409, 'invalid_transition', 'This booking has no payment waiting to be checked');

type Day = { payment: PaymentDoc; booking: BookingDoc };

/**
 * The pending manual payment covering the booking: its lead row (the one with the TrxID) and every
 * row of the same submission with its booking, in time order.
 */
async function pendingSubmission(ownerId: string, booking: BookingDoc, session: ClientSession): Promise<{ lead: PaymentDoc; days: Day[] }> {
  const pending = { ownerId, kind: 'manual', status: 'pending' };
  const own = await Payment.findOne({ ...pending, bookingId: booking._id }).session(session);
  if (!own) throw nothingToCheck();
  const lead = own.trxId
    ? own
    : own.groupId
      ? await Payment.findOne({ ...pending, groupId: own.groupId, trxId: { $type: 'string' } }).session(session)
      : null;
  if (!lead) throw nothingToCheck();
  const rows = lead.groupId ? await Payment.find({ ...pending, groupId: lead.groupId }).session(session) : [lead];
  const bookings = await Booking.find({ ownerId, _id: { $in: rows.map((p) => p.bookingId) } })
    .sort({ startAt: 1, _id: 1 })
    .session(session);
  const days = bookings.map((b) => ({ booking: b, payment: rows.find((p) => String(p.bookingId) === String(b._id))! }));
  if (days.length !== rows.length) throw new Error('A manual payment has no booking');
  return { lead, days };
}

const sum = (days: Day[]) => days.reduce((n, d) => n + d.payment.amount, 0);

/** Every write is guarded on `pending`: of two staff checking the same payment, the second matches nothing. */
const checkedMeanwhile = () => new AppError(409, 'invalid_transition', 'This payment was just checked; reload it');

/**
 * Staff saw the transfer arrive. Each row of the submission succeeds, and the amount received is
 * spread over its bookings in time order, each up to what it owes: a pending booking counts its share
 * and is confirmed; one that can no longer be played (its slots were taken) keeps it as excess and
 * gets it all back. Whatever is left over is one overpayment refund on the lead row. Wallet refunds
 * wait for staff to send them.
 */
export async function verifyManualPayment(
  t: TenantContext,
  booking: BookingDoc,
  input: { amountReceived?: number },
  now: Date,
): Promise<BookingDoc[]> {
  const { ownerId } = t;
  return runInTransaction(async (session) => {
    const { lead, days } = await pendingSubmission(ownerId, booking, session);
    const amountDue = sum(days);
    const amountReceived = input.amountReceived ?? amountDue;

    let left = amountReceived;
    const shares = days.map((d) => {
      // Never past the total: cash taken while the payment waited may already cover some of it.
      const room = d.booking.status === 'pending' ? Math.max(0, d.booking.total - d.booking.amountPaid) : d.payment.amount;
      const share = Math.min(left, d.payment.amount, room);
      left -= share;
      return share;
    });
    const overpaid = left;
    const isLead = (d: Day) => String(d.payment._id) === String(lead._id);

    const out: BookingDoc[] = [];
    for (const [i, d] of days.entries()) {
      const share = shares[i]!;
      const open = d.booking.status === 'pending';
      const paid = await Payment.updateOne(
        { ownerId, _id: d.payment._id, status: 'pending' },
        {
          $set: {
            status: 'succeeded',
            amount: share + (isLead(d) ? overpaid : 0),
            excess: !open,
            verifiedBy: t.userId,
            verifiedAt: now,
          },
        },
        { session },
      );
      if (paid.matchedCount !== 1) throw checkedMeanwhile();
      if (!open) {
        // Not counted in amountPaid, so no cancellation can offer it either.
        if (share >= 1) {
          await reserveRefunds(
            {
              booking: d.booking,
              parts: [{ paymentId: d.payment._id, method: 'wallet', amount: share }],
              reason: 'late_payment',
              ruleApplied: null,
              by: t.userId,
              now,
            },
            session,
          );
        }
        out.push(d.booking);
        continue;
      }
      const amountPaid = d.booking.amountPaid + share;
      const counted = await Booking.findOneAndUpdate(
        { ownerId, _id: d.booking._id, status: 'pending', amountPaid: d.booking.amountPaid },
        { $set: { amountPaid, paymentStatus: paymentStatusFor(amountPaid, d.booking.total) } },
        { session, new: true },
      );
      if (!counted) throw checkedMeanwhile();
      const moved = await transition(t, counted, 'confirmed', now, session, {}, { via: 'manual_payment', paymentId: String(d.payment._id) });
      await noticeBooking('payment_received', moved, now, session);
      out.push(moved);
    }
    if (overpaid >= 1) {
      await reserveRefunds(
        {
          booking: days.find(isLead)!.booking,
          parts: [{ paymentId: lead._id, method: 'wallet', amount: overpaid }],
          reason: 'overpayment',
          ruleApplied: null,
          by: t.userId,
          now,
        },
        session,
      );
    }
    await logActivity(
      t,
      {
        action: 'payment.verified',
        entity: 'payment',
        entityId: String(lead._id),
        venueId: String(lead.venueId),
        after: { trxId: lead.trxId, provider: lead.provider, amountDue, amountReceived },
      },
      now,
      session,
    );
    return out;
  });
}

/**
 * Staff could not find the transfer. Each row of the submission fails, so its TrxID can be entered
 * again, and each booking still pending is rejected, which frees its slots.
 */
export async function rejectManualPayment(t: TenantContext, booking: BookingDoc, now: Date): Promise<BookingDoc[]> {
  const { ownerId } = t;
  return runInTransaction(async (session) => {
    const { lead, days } = await pendingSubmission(ownerId, booking, session);
    const out: BookingDoc[] = [];
    for (const d of days) {
      const failed = await Payment.updateOne(
        { ownerId, _id: d.payment._id, status: 'pending' },
        { $set: { status: 'failed', failureCode: 'not_received', verifiedBy: t.userId, verifiedAt: now } },
        { session },
      );
      if (failed.matchedCount !== 1) throw checkedMeanwhile();
      if (d.booking.status !== 'pending') {
        out.push(d.booking);
        continue;
      }
      const moved = await transition(t, d.booking, 'rejected', now, session, { rejectReason: 'payment_not_received' });
      await noticeBooking('payment_not_found', moved, now, session);
      out.push(moved);
    }
    await logActivity(
      t,
      {
        action: 'payment.not_received',
        entity: 'payment',
        entityId: String(lead._id),
        venueId: String(lead.venueId),
        after: { trxId: lead.trxId, provider: lead.provider, amountDue: sum(days) },
      },
      now,
      session,
    );
    return out;
  });
}
