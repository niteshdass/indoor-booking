import type { Action } from '../bookings/availableActions';
import type { OwnerBooking } from '../types';

/** A confirmed booking starting within this long is due for check-in rather than payment. */
export const SOON_MS = 30 * 60_000;

/** The one action a Coming up row leads with, or null when none of this member's actions is the obvious next step. */
export function nextStep(b: OwnerBooking, actions: Action[], now: Date): Action | null {
  const has = (a: Action) => actions.includes(a);
  if (has('verify')) return 'verify';
  if (b.status === 'pending') return has('confirm') ? 'confirm' : null;
  if (b.status === 'awaiting_payment') return has('paymentLink') ? 'paymentLink' : null;
  if (b.status !== 'confirmed') return null;
  const start = Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
  if (start <= now.getTime() + SOON_MS && has('checkIn')) return 'checkIn';
  return has('markCash') ? 'markCash' : null;
}
