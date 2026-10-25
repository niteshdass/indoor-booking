import type { OwnerBooking } from '../types';

const DEAD = new Set(['cancelled', 'rejected', 'expired']);
const OPEN = new Set(['pending', 'awaiting_payment', 'confirmed']);

const firstStart = (b: OwnerBooking) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
const lastEnd = (b: OwnerBooking) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));

export type TodaySummary = { count: number; collected: number; pending: number; upcoming: OwnerBooking[] };

/** Day totals for the stat cards plus the still-to-come queue. Collected nets refunds and includes cancelled bookings. */
export function summarize(bookings: OwnerBooking[], now: Date = new Date()): TodaySummary {
  const nowMs = now.getTime();
  return {
    count: bookings.filter((b) => !DEAD.has(b.status)).length,
    collected: bookings.reduce((sum, b) => sum + b.amountPaid - b.amountRefunded, 0),
    pending: bookings.filter((b) => b.status === 'pending').length,
    upcoming: bookings
      .filter((b) => OPEN.has(b.status) && lastEnd(b) > nowMs)
      .sort((a, b) => firstStart(a) - firstStart(b)),
  };
}
