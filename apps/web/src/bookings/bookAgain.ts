import { addDays, localParts, weekdayOf } from '@booking/shared';
import type { BookingJson } from '../lib/types';

/** Still to be played: the next game must come after it. */
const ON = new Set(['pending', 'confirmed']);

export type BookAgain = { href: string; date: string };

/**
 * The venue page on the same turf with the same start times picked, on the next day with the booking's
 * weekday: today while the first start is still ahead, and never on or before a booking that is still on.
 * Null without a venue, slots, or while the booking waits for payment.
 */
export function bookAgain(b: BookingJson, now: Date): BookAgain | null {
  if (!b.venue || b.slots.length === 0 || b.status === 'awaiting_payment') return null;
  const tz = b.venue.timezone;
  const times = [...b.slots]
    .sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))
    .map((s) => localParts(new Date(s.startAt), tz).hm);
  const here = localParts(now, tz);
  const want = weekdayOf(b.businessDate);
  let date = here.date;
  while (weekdayOf(date) !== want) date = addDays(date, 1);
  if (date === here.date && times[0]! <= here.hm) date = addDays(date, 7);
  if (ON.has(b.status)) while (date <= b.businessDate) date = addDays(date, 7);
  const q = new URLSearchParams({ turf: b.turfId, date, times: times.join(',') });
  return { href: `/venues/${encodeURIComponent(b.venue.slug)}?${q.toString()}`, date };
}
