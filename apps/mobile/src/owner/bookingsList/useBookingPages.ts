import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/api';
import type { OwnerBooking } from '../types';
import { apiPathFor, type BookingFilters } from './filters';

/** One page of `GET /owners/:id/bookings`; the Dues tab adds what every matching booking still owes, per currency. */
export type ListPage = { bookings: OwnerBooking[]; total: number; due?: { currency: string; amount: number }[] };

type State = {
  key: string;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  bookings: OwnerBooking[];
  total: number;
  due?: ListPage['due'];
  /** Pages loaded so far. */
  page: number;
};

/**
 * The web list's pages, appended as the owner scrolls (load more instead of page buttons). A filter change starts
 * again from page 1; `refresh` reloads page 1 and keeps the rows on screen until it lands.
 */
export function useBookingPages(ownerId: string, filters: BookingFilters) {
  const key = apiPathFor(ownerId, filters, 1);
  const [state, setState] = useState<State>({ key, status: 'loading', error: null, bookings: [], total: 0, page: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const live = useRef(key);
  live.current = key;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadFirst = useCallback(
    (asRefresh: boolean) => {
      const k = live.current;
      if (asRefresh) setRefreshing(true);
      else setState({ key: k, status: 'loading', error: null, bookings: [], total: 0, page: 0 });
      setMoreError(null);
      apiGet<ListPage>(apiPathFor(ownerId, filtersRef.current, 1))
        .then((res) => {
          if (live.current !== k) return;
          setState({ key: k, status: 'ready', error: null, bookings: res.bookings, total: res.total, due: res.due, page: 1 });
        })
        .catch((error: unknown) => {
          if (live.current !== k) return;
          setState((s) => (asRefresh && s.key === k && s.status === 'ready' ? s : { key: k, status: 'error', error, bookings: [], total: 0, page: 0 }));
        })
        .finally(() => {
          if (live.current === k) setRefreshing(false);
        });
    },
    [ownerId],
  );

  useEffect(() => {
    loadFirst(false);
  }, [key, loadFirst]);

  const current = state.key === key ? state : { ...state, status: 'loading' as const, bookings: [], total: 0, page: 0 };
  const hasMore = current.status === 'ready' && current.bookings.length < current.total;

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    const k = live.current;
    const next = current.page + 1;
    setLoadingMore(true);
    setMoreError(null);
    apiGet<ListPage>(apiPathFor(ownerId, filtersRef.current, next))
      .then((res) => {
        if (live.current !== k) return;
        setState((s) => {
          if (s.key !== k) return s;
          const seen = new Set(s.bookings.map((b) => b.id));
          return { ...s, bookings: [...s.bookings, ...res.bookings.filter((b) => !seen.has(b.id))], total: res.total, due: res.due, page: next };
        });
      })
      .catch((e: unknown) => live.current === k && setMoreError(e))
      .finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, current.page, ownerId]);

  return {
    status: current.status,
    error: current.error,
    bookings: current.bookings,
    total: current.total,
    due: current.due,
    hasMore,
    loadingMore,
    moreError,
    refreshing,
    loadMore,
    refresh: () => loadFirst(true),
    retry: () => loadFirst(false),
  };
}
