import { BOOKING_STATUSES, type BookingStatus } from '@booking/shared';
import { PAGE_SIZE } from '../../components/ui/Pagination';
import { ownerPath } from '../ownerApi';

export const BOOKING_TABS = ['all', 'today', 'upcoming', 'past'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

/** Field and direction: when the booking was made, when it is played, or its reference. */
export const BOOKING_SORTS = ['created-desc', 'created-asc', 'date-asc', 'date-desc', 'ref-asc', 'ref-desc'] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

/** Each tab's order unless the owner picks one (same as the API's). */
export const DEFAULT_SORT: Record<BookingTab, BookingSort> = {
  all: 'created-desc',
  today: 'date-asc',
  upcoming: 'date-asc',
  past: 'date-desc',
};

export type BookingFilters = {
  venueId: string;
  tab: BookingTab;
  sort: BookingSort;
  turfId: string | null;
  /** An optional date range inside the tab. */
  from: string | null;
  to: string | null;
  status: BookingStatus | null;
  q: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

/** Filters from the URL: the All tab in its default order, no range, every turf and status. The venue itself is `venueId`. */
export function readFilters(p: URLSearchParams, venueId: string): BookingFilters {
  const date = (key: string) => {
    const v = p.get(key);
    return v && DATE.test(v) && isRealDate(v) ? v : null;
  };
  const tab = BOOKING_TABS.find((x) => x === p.get('tab')) ?? 'all';
  const status = p.get('status');
  return {
    venueId,
    tab,
    sort: BOOKING_SORTS.find((x) => x === p.get('sort')) ?? DEFAULT_SORT[tab],
    turfId: p.get('turf') || null,
    from: date('from'),
    to: date('to'),
    status: BOOKING_STATUSES.find((s) => s === status) ?? null,
    q: p.get('q') ?? '',
  };
}

/** URL params for the filters except the venue and the page; defaults are omitted. */
export function filtersToParams(f: BookingFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.sort !== DEFAULT_SORT[f.tab]) p.set('sort', f.sort);
  if (f.turfId) p.set('turf', f.turfId);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  return p;
}

/** One page of the list. */
export function apiPathFor(ownerId: string, f: BookingFilters, page: number): string {
  const p = new URLSearchParams({ venueId: f.venueId, scope: f.tab, sort: f.sort, page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.turfId) p.set('turfId', f.turfId);
  if (f.status) p.set('status', f.status);
  if (f.q.trim()) p.set('q', f.q.trim());
  return ownerPath(ownerId, `/bookings?${p.toString()}`);
}

export function rangeError(f: BookingFilters): 'owner.bookings.rangeOrder' | null {
  return f.from && f.to && f.to < f.from ? 'owner.bookings.rangeOrder' : null;
}
