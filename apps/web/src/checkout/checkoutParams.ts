import { MAX_SLOTS_PER_BOOKING } from '@booking/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function validDate(s: string | null): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

export type CheckoutParams = { turfId: string; date: string; startAts: string[] };

export function checkoutHref(slug: string, turfId: string, date: string, startAts: string[]): string {
  const q = new URLSearchParams({ turf: turfId, date, slots: startAts.join(',') });
  return `/venues/${encodeURIComponent(slug)}/checkout?${q.toString()}`;
}

/** Null unless turf, date and 1..MAX_SLOTS_PER_BOOKING valid instants are all present. Instants are deduped and sorted. */
export function readCheckout(p: URLSearchParams): CheckoutParams | null {
  const turfId = p.get('turf');
  const date = p.get('date');
  const raw = p.get('slots');
  if (!turfId || !validDate(date) || !raw) return null;
  const parts = raw.split(',');
  if (parts.length > MAX_SLOTS_PER_BOOKING) return null;
  const times = new Set<number>();
  for (const part of parts) {
    if (!ISO_INSTANT.test(part)) return null;
    const ms = Date.parse(part);
    if (Number.isNaN(ms)) return null;
    times.add(ms);
  }
  if (times.size === 0 || times.size > MAX_SLOTS_PER_BOOKING) return null;
  return { turfId, date, startAts: [...times].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString()) };
}
