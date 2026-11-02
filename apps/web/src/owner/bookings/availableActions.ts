import { MOVABLE, type BookingStatus } from '@booking/shared';
import type { OwnerBooking, Permission } from '../types';

export type Action = 'verify' | 'confirm' | 'reject' | 'move' | 'cancel' | 'checkIn' | 'noShow' | 'markCash' | 'paymentLink';

/** Statuses that still take a cash payment. */
const CASH_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];

/** What this member may do with the booking right now (Global Constraints table), in display order. */
export function availableActions(b: OwnerBooking, can: (p: Permission) => boolean, now = Date.now()): Action[] {
  const out: Action[] = [];
  // A submitted wallet payment has to be checked first: only verify moves the booking, never confirm or reject.
  const toVerify = awaitsVerification(b);
  if (toVerify && can('payment.verify')) out.push('verify');
  if (b.status === 'pending' && !toVerify && can('booking.confirm')) out.push('confirm', 'reject');
  if (MOVABLE.includes(b.status) && !ended(b, now) && can('booking.reschedule')) out.push('move');
  if (CANCELLABLE.includes(b.status) && can('booking.cancel')) out.push('cancel');
  if (b.status === 'confirmed' && can('booking.checkin')) out.push('checkIn', 'noShow');
  if (CASH_STATUSES.includes(b.status) && b.amountPaid < b.total && !toVerify && can('payment.mark_cash')) out.push('markCash');
  if (b.status === 'awaiting_payment' && b.source === 'walkin' && can('booking.create')) out.push('paymentLink');
  return out;
}

/** A wallet payment the player submitted that staff have not checked yet. */
export function awaitsVerification(b: OwnerBooking): boolean {
  return b.manualPayment?.status === 'pending';
}

/** The booking's last slot is over: staff can no longer move it. */
function ended(b: OwnerBooking, now: number): boolean {
  const end = b.slots.reduce((max, s) => Math.max(max, Date.parse(s.endAt)), 0);
  return end > 0 && end <= now;
}
