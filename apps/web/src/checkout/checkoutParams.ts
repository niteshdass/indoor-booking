import { MAX_BOOKINGS_PER_GROUP, MAX_SLOTS_PER_BOOKING } from '@booking/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function validDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** One more booking in the same checkout: a run of slots on its own day. */
export type CheckoutItem = { date: string; startAts: string[] };

/** `more`: further bookings made in the same checkout, each at its own day and times. */
export type CheckoutParams = { turfId: string; date: string; startAts: string[]; more: CheckoutItem[] };

export function checkoutHref(slug: string, turfId: string, date: string, startAts: string[], more: CheckoutItem[] = []): string {
  const q = new URLSearchParams({ turf: turfId, date, slots: startAts.join(',') });
  if (more.length > 0) q.set('more', more.map((i) => `${i.date}:${i.startAts.join(',')}`).join(';'));
  return `/venues/${encodeURIComponent(slug)}/checkout?${q.toString()}`;
}

/** 1..MAX_SLOTS_PER_BOOKING valid instants, deduped and sorted; null when malformed. */
function readInstants(raw: string): string[] | null {
  const parts = raw.split(',');
  if (parts.length > MAX_SLOTS_PER_BOOKING) return null;
  const times = new Set<number>();
  for (const part of parts) {
    if (!ISO_INSTANT.test(part)) return null;
    const ms = Date.parse(part);
    if (Number.isNaN(ms)) return null;
    times.add(ms);
  }
  if (times.size === 0) return null;
  return [...times].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
}

/** `date:instant,instant;date:instant`; null when any part is malformed or there are too many. */
function readMore(raw: string | null): CheckoutItem[] | null {
  if (!raw) return [];
  const parts = raw.split(';');
  if (parts.length > MAX_BOOKINGS_PER_GROUP - 1) return null;
  const items: CheckoutItem[] = [];
  for (const part of parts) {
    const date = part.slice(0, 10);
    const startAts = part[10] === ':' ? readInstants(part.slice(11)) : null;
    if (!validDate(date) || !startAts) return null;
    items.push({ date, startAts });
  }
  return items;
}

/**
 * Null unless turf, date and 1..MAX_SLOTS_PER_BOOKING valid instants are all present. Instants are
 * deduped and sorted, as are those of each further booking.
 */
export function readCheckout(p: URLSearchParams): CheckoutParams | null {
  const turfId = p.get('turf');
  const date = p.get('date');
  const raw = p.get('slots');
  if (!turfId || !validDate(date) || !raw) return null;
  const startAts = readInstants(raw);
  const more = readMore(p.get('more'));
  if (!startAts || !more) return null;
  return { turfId, date, startAts, more };
}
