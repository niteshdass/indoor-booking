import { MAX_BOOKINGS_PER_GROUP, MAX_SLOTS_PER_BOOKING } from '@booking/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function validDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

const TURF_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One more booking in the same checkout: a run of slots on its own day, on the main court unless `turfId` names another. */
export type CheckoutItem = { turfId?: string; date: string; startAts: string[] };

/** `more`: further bookings made in the same checkout, each at its own court, day and times. */
export type CheckoutParams = { turfId: string; date: string; startAts: string[]; more: CheckoutItem[] };

/** `date:instants`, or `date@turfId:instants` for a court other than `main`. */
export const moreParam = (main: string, more: CheckoutItem[]) =>
  more.map((i) => `${i.date}${i.turfId && i.turfId !== main ? `@${i.turfId}` : ''}:${i.startAts.join(',')}`).join(';');

export function checkoutHref(slug: string, turfId: string, date: string, startAts: string[], more: CheckoutItem[] = []): string {
  const q = new URLSearchParams({ turf: turfId, date, slots: startAts.join(',') });
  if (more.length > 0) q.set('more', moreParam(turfId, more));
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

/** `date:instant,instant;date@turfId:instant`; null when any part is malformed or there are too many. */
function readMore(raw: string | null): CheckoutItem[] | null {
  if (!raw) return [];
  const parts = raw.split(';');
  if (parts.length > MAX_BOOKINGS_PER_GROUP - 1) return null;
  const items: CheckoutItem[] = [];
  for (const part of parts) {
    const date = part.slice(0, 10);
    const colon = part.indexOf(':', 10);
    const turfId = part[10] === '@' ? part.slice(11, colon) : undefined;
    if (!validDate(date) || colon < 0 || (turfId === undefined ? colon !== 10 : !TURF_ID.test(turfId))) return null;
    const startAts = readInstants(part.slice(colon + 1));
    if (!startAts) return null;
    items.push({ ...(turfId ? { turfId } : {}), date, startAts });
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
