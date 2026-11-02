import { amountDue } from '@booking/shared';
import { awaitsVerification } from '../bookings/availableActions';
import type { OwnerBooking } from '../types';

const DEAD = new Set(['cancelled', 'rejected', 'expired']);
const OPEN = new Set(['pending', 'awaiting_payment', 'confirmed']);

export const firstStart = (b: OwnerBooking) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
const lastEnd = (b: OwnerBooking) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));

export type TodaySummary = {
  count: number;
  collected: number;
  /** Left to take at the desk on today's confirmed and played bookings, from `owing` of them; `overdue` have already ended. */
  due: { amount: number; owing: number; overdue: number };
  pending: number;
  upcoming: OwnerBooking[];
};

/** Day totals for the stat cards plus the still-to-come queue. Collected nets refunds and includes cancelled bookings. */
export function summarize(bookings: OwnerBooking[], now: Date = new Date()): TodaySummary {
  const nowMs = now.getTime();
  const owing = bookings.filter((b) => amountDue(b) > 0);
  return {
    count: bookings.filter((b) => !DEAD.has(b.status)).length,
    collected: bookings.reduce((sum, b) => sum + b.amountPaid - b.amountRefunded, 0),
    due: {
      amount: owing.reduce((sum, b) => sum + amountDue(b), 0),
      owing: owing.length,
      overdue: owing.filter((b) => lastEnd(b) <= nowMs).length,
    },
    // A booking waiting on a wallet check is counted in payments to verify instead.
    pending: bookings.filter((b) => b.status === 'pending' && !awaitsVerification(b)).length,
    upcoming: bookings
      .filter((b) => OPEN.has(b.status) && lastEnd(b) > nowMs)
      .sort((a, b) => firstStart(a) - firstStart(b)),
  };
}
