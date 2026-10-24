import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchResponse, SearchResult } from '@booking/shared';
import { apiGet } from '../lib/apiClient';
import { apiQuery, criteriaToParams, type Criteria } from './searchParams';

/** A page can be empty yet carry a cursor (filtered-out venues still advance it); one page is this many results. */
export const PAGE_SIZE = 20;
/** Extra requests made automatically per load while the batch is smaller than a page. */
export const AUTO_FOLLOW_MAX = 10;

export type SearchStatus = 'loading' | 'idle' | 'error';

type State = {
  key: string;
  results: SearchResult[];
  nextCursor: number | null;
  status: SearchStatus;
  error: unknown;
};

const initial = (key: string): State => ({ key, results: [], nextCursor: null, status: 'loading', error: null });

export function useSearch(c: Criteria): {
  results: SearchResult[];
  status: SearchStatus;
  error: unknown;
  hasMore: boolean;
  loadMore(): void;
  retry(): void;
} {
  const key = criteriaToParams(c).toString();
  const [state, setState] = useState<State>(() => initial(key));

  const criteria = useRef(c);
  const requestId = useRef(0);
  const startedKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const accumulated = useRef<SearchResult[]>([]);
  const nextCursor = useRef<number | null>(null);
  const failedCursor = useRef<number | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    criteria.current = c;
  });

  /** One load: fetch `cursor`, then keep following while this load's batch is short. Strictly one request at a time. */
  const load = useCallback(async (id: number, loadKey: string, start: number, reset: boolean): Promise<void> => {
    inFlight.current = true;
    failedCursor.current = null;
    // A new criteria drops everything from the old one; loadMore/retry keep what was already loaded.
    setState((s) => (reset ? initial(loadKey) : { ...s, key: loadKey, status: 'loading', error: null }));
    const base = accumulated.current.length;
    let cursor = start;
    let extra = 0;
    for (;;) {
      let page: SearchResponse;
      try {
        page = await apiGet<SearchResponse>(`/search${apiQuery(criteria.current, cursor)}`);
      } catch (error) {
        if (id !== requestId.current || unmounted.current) return;
        inFlight.current = false;
        failedCursor.current = cursor;
        setState((s) => ({ ...s, key: loadKey, status: 'error', error }));
        return;
      }
      if (id !== requestId.current || unmounted.current) return;
      accumulated.current = [...accumulated.current, ...page.results];
      nextCursor.current = page.nextCursor;
      const batch = accumulated.current.length - base;
      const follow = page.nextCursor !== null && batch < PAGE_SIZE && extra < AUTO_FOLLOW_MAX;
      const results = accumulated.current;
      setState((s) => ({
        ...s,
        key: loadKey,
        results,
        nextCursor: page.nextCursor,
        status: follow ? 'loading' : 'idle',
        error: null,
      }));
      if (!follow) {
        inFlight.current = false;
        return;
      }
      cursor = page.nextCursor!;
      extra += 1;
    }
  }, []);

  useEffect(() => {
    // Stops a running chain before its next request. StrictMode's simulated unmount/remount flips this back at once.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  useEffect(() => {
    // StrictMode re-runs effects with the same key; the chain already running for it is still valid.
    if (startedKey.current === key) return;
    startedKey.current = key;
    requestId.current += 1; // discards any in-flight chain for the previous criteria
    accumulated.current = [];
    nextCursor.current = null;
    failedCursor.current = null;
    void load(requestId.current, key, 0, true);
  }, [key, load]);

  const loadMore = useCallback(() => {
    if (inFlight.current || failedCursor.current !== null || nextCursor.current === null) return;
    void load(requestId.current, startedKey.current ?? key, nextCursor.current, false);
  }, [key, load]);

  const retry = useCallback(() => {
    if (inFlight.current || failedCursor.current === null) return;
    void load(requestId.current, startedKey.current ?? key, failedCursor.current, false);
  }, [key, load]);

  const cur = state.key === key ? state : initial(key);
  return {
    results: cur.results,
    status: cur.status,
    error: cur.error,
    hasMore: cur.nextCursor !== null,
    loadMore,
    retry,
  };
}
