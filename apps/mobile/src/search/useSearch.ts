import { useCallback, useEffect, useRef, useState } from 'react';
import { apiQuery, criteriaToParams, type Criteria, type SearchResponse, type SearchResult } from '@booking/shared';
import { apiGet } from '../lib/api';

/** One page is this many results; a load keeps following empty or short pages up to AUTO_FOLLOW_MAX extra requests. */
export const PAGE_SIZE = 20;
export const AUTO_FOLLOW_MAX = 10;

export type SearchStatus = 'loading' | 'idle' | 'error';

type State = { key: string; results: SearchResult[]; nextCursor: number | null; status: SearchStatus; error: unknown };

const initial = (key: string): State => ({ key, results: [], nextCursor: null, status: 'loading', error: null });

/**
 * Pages through GET /search for the given criteria. New criteria drop the old list; `loadMore` and `retry` keep it.
 * Answers that arrive for criteria the player has since left are ignored.
 */
export function useSearch(criteria: Criteria): {
  results: SearchResult[];
  status: SearchStatus;
  error: unknown;
  hasMore: boolean;
  loadMore(): void;
  retry(): void;
} {
  const key = criteriaToParams(criteria).toString();
  const [state, setState] = useState<State>(() => initial(key));
  const latest = useRef({ criteria, key });
  const busy = useRef(false);
  const run = useRef(0);

  /**
   * One load: fetch `start`, then keep following while this load's batch is shorter than a page and a cursor remains
   * (filtered-out venues advance the cursor, so a page can be empty). Bounded like the web search.
   */
  const fetchPage = useCallback(async (start: number, reset: boolean) => {
    const { criteria: c, key: k } = latest.current;
    const id = ++run.current;
    busy.current = true;
    setState((s) => (reset ? initial(k) : { ...s, key: k, status: 'loading', error: null }));
    let cursor = start;
    let batch = 0;
    let extra = 0;
    let first = reset;
    try {
      for (;;) {
        const page = await apiGet<SearchResponse>(`/search${apiQuery(c, cursor)}`);
        if (id !== run.current) return;
        batch += page.results.length;
        const follow = page.nextCursor !== null && batch < PAGE_SIZE && extra < AUTO_FOLLOW_MAX;
        const replace = first;
        setState((s) => ({
          key: k,
          results: replace ? page.results : [...s.results, ...page.results],
          nextCursor: page.nextCursor,
          status: follow ? 'loading' : 'idle',
          error: null,
        }));
        first = false;
        if (!follow) return;
        cursor = page.nextCursor!;
        extra += 1;
      }
    } catch (error) {
      if (id !== run.current) return;
      setState((s) => ({ ...s, key: k, status: 'error', error }));
    } finally {
      if (id === run.current) busy.current = false;
    }
  }, []);

  useEffect(() => {
    latest.current = { criteria, key };
    void fetchPage(0, true);
    // The key is the criteria's identity; `criteria` itself changes identity on every render.
  }, [key, fetchPage]);

  const loadMore = useCallback(() => {
    if (busy.current || state.key !== key || state.nextCursor === null) return;
    void fetchPage(state.nextCursor, false);
  }, [fetchPage, key, state.key, state.nextCursor]);

  // After an error the list is whatever was loaded; retry repeats the page that failed.
  const retry = useCallback(() => {
    if (busy.current) return;
    const first = state.results.length === 0 || state.nextCursor === null;
    void fetchPage(first ? 0 : state.nextCursor!, first);
  }, [fetchPage, state.results.length, state.nextCursor]);

  const cur = state.key === key ? state : initial(key);
  return { results: cur.results, status: cur.status, error: cur.error, hasMore: cur.nextCursor !== null, loadMore, retry };
}
