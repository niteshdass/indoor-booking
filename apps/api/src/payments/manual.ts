import type { ClientSession } from 'mongoose';
import { normalizeTrxId, type WalletProvider } from '@booking/shared';
import { normalizeBdMobile } from '../auth/normalize';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { keyHas } from '../bookings/create';
import { Payment, type PaymentDoc } from '../bookings/payment.model';
import { SlotLock } from '../bookings/slotLock.model';
import { invalidTransition, transition, type Actor } from '../bookings/transition';
import type { AppServices } from '../services';
import { logActivity, logSystemActivity } from '../tenancy/activityLog.model';
import { effectiveForVenue } from '../venues/effective';
import { lockTurf } from '../venues/guards';
import { Venue } from '../venues/venue.model';
import { stillFree } from './apply';
import { paymentsUnavailable } from './intent';

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
