import type { OwnerBooking } from '../types';

const DEAD = new Set(['cancelled', 'rejected', 'expired']);
const OPEN = new Set(['pending', 'awaiting_payment', 'confirmed']);

const firstStart = (b: OwnerBooking) => b.slots.map((s) => s.startAt).sort()[0] ?? '';
const lastEnd = (b: OwnerBooking) => b.slots.map((s) => s.endAt).sort().at(-1) ?? '';

export type TodaySummary = { count: number; collected: number; pending: number; upcoming: OwnerBooking[] };

/** Day totals for the stat cards plus the still-to-come queue. Collected nets refunds and includes cancelled bookings. */
export function summarize(bookings: OwnerBooking[], now: Date = new Date()): TodaySummary {
  const nowIso = now.toISOString();
  return {
    count: bookings.filter((b) => !DEAD.has(b.status)).length,
    collected: bookings.reduce((sum, b) => sum + b.amountPaid - b.amountRefunded, 0),
    pending: bookings.filter((b) => b.status === 'pending').length,
    upcoming: bookings
      .filter((b) => OPEN.has(b.status) && lastEnd(b) > nowIso)
      .sort((a, b) => firstStart(a).localeCompare(firstStart(b))),
  };
}
