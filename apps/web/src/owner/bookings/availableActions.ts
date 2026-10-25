import type { BookingStatus } from '@booking/shared';
import type { OwnerBooking, Permission } from '../types';

export type Action = 'confirm' | 'reject' | 'cancel' | 'checkIn' | 'noShow' | 'markCash' | 'paymentLink';

/** Statuses that still take a cash payment. */
const CASH_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];

/** What this member may do with the booking right now (Global Constraints table), in display order. */
export function availableActions(b: OwnerBooking, can: (p: Permission) => boolean): Action[] {
  const out: Action[] = [];
  if (b.status === 'pending' && can('booking.confirm')) out.push('confirm', 'reject');
  if (CANCELLABLE.includes(b.status) && can('booking.cancel')) out.push('cancel');
  if (b.status === 'confirmed' && can('booking.checkin')) out.push('checkIn', 'noShow');
  if (CASH_STATUSES.includes(b.status) && b.amountPaid < b.total && can('payment.mark_cash')) out.push('markCash');
  if (b.status === 'awaiting_payment' && b.source === 'walkin' && can('booking.create')) out.push('paymentLink');
  return out;
}
