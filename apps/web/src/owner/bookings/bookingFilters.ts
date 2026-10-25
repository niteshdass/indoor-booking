import { BOOKING_STATUSES, localParts, type BookingStatus } from '@booking/shared';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, OwnerVenue } from '../types';

export type BookingFilters = {
  venueId: string;
  turfId: string | null;
  from: string;
  to: string;
  status: BookingStatus | null;
  q: string;
};

/** The API caps a list at this many rows. */
export const BOOKINGS_CAP = 500;
const MAX_DAYS = 31;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

const venueToday = (venue: OwnerVenue) => localParts(new Date(), venue.timezone).date;

/** Filters from the URL; `from` and `to` default to the venue-local today. The venue itself is `venue`. */
export function readFilters(p: URLSearchParams, venue: OwnerVenue): BookingFilters {
  const today = venueToday(venue);
  const date = (key: string) => {
    const v = p.get(key);
    return v && DATE.test(v) && isRealDate(v) ? v : today;
  };
  const status = p.get('status');
  return {
    venueId: venue.id,
    turfId: p.get('turf') || null,
    from: date('from'),
    to: date('to'),
    status: BOOKING_STATUSES.find((s) => s === status) ?? null,
    q: p.get('q') ?? '',
  };
}

/** URL params for the filters except the venue; defaults (today's dates, empty values) are omitted. */
export function filtersToParams(f: BookingFilters, today?: string): URLSearchParams {
  const p = new URLSearchParams();
  if (f.turfId) p.set('turf', f.turfId);
  if (f.from !== today) p.set('from', f.from);
  if (f.to !== today) p.set('to', f.to);
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  return p;
}

/** The list request. Search is client-side, so `q` is never sent. */
export function apiPathFor(ownerId: string, f: BookingFilters): string {
  const p = new URLSearchParams({ venueId: f.venueId, from: f.from, to: f.to });
  if (f.turfId) p.set('turfId', f.turfId);
  if (f.status) p.set('status', f.status);
  return ownerPath(ownerId, `/bookings?${p.toString()}`);
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Case-insensitive match on reference or customer name, or on the digits of the customer's phone. */
export function matchesQuery(b: OwnerBooking, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (b.reference.toLowerCase().includes(needle)) return true;
  if (b.customer?.name.toLowerCase().includes(needle)) return true;
  if (b.guest?.name.toLowerCase().includes(needle)) return true;
  const d = digits(needle);
  return d !== '' && digits(b.customer?.phone ?? b.guest?.phone ?? '').includes(d);
}

export function rangeError(f: BookingFilters): 'owner.bookings.rangeOrder' | 'owner.bookings.rangeMax' | null {
  if (f.to < f.from) return 'owner.bookings.rangeOrder';
  const days = (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000 + 1;
  return days > MAX_DAYS ? 'owner.bookings.rangeMax' : null;
}
