import type { BookingStatus } from '@booking/shared';
import { ownerPath } from '../labels';

/** Mirrors apps/web/src/owner/bookings/bookingFilters.ts. `to_verify`: a wallet payment still to check; `dues`: money still to collect. */
export const BOOKING_TABS = ['all', 'today', 'upcoming', 'past', 'to_verify', 'dues'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export const BOOKING_SORTS = ['created-desc', 'created-asc', 'date-asc', 'date-desc', 'ref-asc', 'ref-desc'] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

/** Each tab's order unless the owner picks one (same as the API's). */
export const DEFAULT_SORT: Record<BookingTab, BookingSort> = {
  all: 'created-desc',
  today: 'date-asc',
  upcoming: 'date-asc',
  past: 'date-desc',
  to_verify: 'date-asc',
  dues: 'date-asc',
};

/** Same page size as the web list (apps/web/src/components/ui/Pagination.tsx). */
export const PAGE_SIZE = 25;

export type BookingFilters = {
  /** null: every venue the member can see. */
  venueId: string | null;
  tab: BookingTab;
  sort: BookingSort;
  turfId: string | null;
  from: string | null;
  to: string | null;
  status: BookingStatus | null;
  q: string;
};

export const EMPTY_FILTERS: BookingFilters = {
  venueId: null,
  tab: 'all',
  sort: DEFAULT_SORT.all,
  turfId: null,
  from: null,
  to: null,
  status: null,
  q: '',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written `YYYY-MM-DD`. */
export function isDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/** One page of the list. */
export function apiPathFor(ownerId: string, f: BookingFilters, page: number): string {
  const p = new URLSearchParams({ scope: f.tab, sort: f.sort, page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.venueId) p.set('venueId', f.venueId);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.turfId) p.set('turfId', f.turfId);
  if (f.status) p.set('status', f.status);
  if (f.q.trim()) p.set('q', f.q.trim());
  return ownerPath(ownerId, `/bookings?${p.toString()}`);
}

export function rangeError(f: Pick<BookingFilters, 'from' | 'to'>): 'owner.bookings.rangeOrder' | null {
  return f.from && f.to && f.to < f.from ? 'owner.bookings.rangeOrder' : null;
}

/** Filters in the sheet that narrow the tab; the filter button shows the count. */
export function activeCount(f: BookingFilters): number {
  return [f.venueId, f.turfId, f.status, f.from || f.to].filter(Boolean).length;
}
