import { localParts } from '@booking/shared';
import type { PlayerBooking } from './types';

/** The player can still cancel while the booking is live (the API refuses the rest). */
export const CANCELLABLE = new Set(['awaiting_payment', 'pending', 'confirmed']);
const OWING = new Set(['pending', 'confirmed']);

const startMs = (b: PlayerBooking) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
const endMs = (b: PlayerBooking) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));

/**
 * Same split as the web My bookings page: live bookings that have not ended are upcoming (soonest first),
 * everything else is past (latest first).
 */
export function splitBookings(bookings: PlayerBooking[], now: number): { upcoming: PlayerBooking[]; past: PlayerBooking[] } {
  const upcoming: PlayerBooking[] = [];
  const past: PlayerBooking[] = [];
  for (const b of bookings) {
    const live = b.slots.length > 0 && CANCELLABLE.has(b.status) && endMs(b) > now;
    (live ? upcoming : past).push(b);
  }
  upcoming.sort((a, b) => startMs(a) - startMs(b));
  past.sort((a, b) => (b.slots.length ? startMs(b) : 0) - (a.slots.length ? startMs(a) : 0));
  return { upcoming, past };
}

/** "Fri, 5 Nov" from the business date (already the venue's local day) and "19:00–20:00" in the venue's timezone. */
export function bookingWhen(b: PlayerBooking, lang: string): { day: string; range: string | null } {
  const tz = b.venue?.timezone ?? 'UTC';
  const day = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${b.businessDate}T12:00:00Z`));
  const first = b.slots[0];
  const last = b.slots.at(-1);
  const range = first && last ? `${localParts(new Date(first.startAt), tz).hm}–${localParts(new Date(last.endAt), tz).hm}` : null;
  return { day, range };
}

/** What is still owed on a live booking; nothing once it is cancelled or refunded. */
export function amountDue(b: PlayerBooking): number {
  return OWING.has(b.status) && b.amountRefunded === 0 ? Math.max(0, b.total - b.amountPaid) : 0;
}

/** A wallet payment the venue has not checked yet. */
export const manualPending = (b: PlayerBooking): boolean => b.manualPayment?.status === 'pending';

/** Universal https link: opens Google Maps where installed, the browser otherwise, on both platforms. */
export function mapsUrl(location: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}
