import type { BookingStatus } from '@booking/shared';
import type { OwnerBooking, Permission } from '../types';

export type Action = 'verify' | 'confirm' | 'reject' | 'cancel' | 'checkIn' | 'noShow' | 'markCash' | 'paymentLink';

/** Statuses that still take a cash payment. */
const CASH_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];

/** What this member may do with the booking right now (Global Constraints table), in display order. */
export function availableActions(b: OwnerBooking, can: (p: Permission) => boolean): Action[] {
  const out: Action[] = [];
  // A submitted wallet payment has to be checked first: only verify moves the booking, never confirm or reject.
  const toVerify = awaitsVerification(b);
  if (toVerify && can('payment.verify')) out.push('verify');
  if (b.status === 'pending' && !toVerify && can('booking.confirm')) out.push('confirm', 'reject');
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
