import { useCallback, useEffect, useRef, useState } from 'react';
import { apiQuery, criteriaToParams, type Criteria, type SearchResponse, type SearchResult } from '@booking/shared';
import { apiGet } from '../lib/api';

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

  const fetchPage = useCallback(async (start: number, reset: boolean) => {
    const { criteria: c, key: k } = latest.current;
    const id = ++run.current;
    busy.current = true;
    setState((s) => (reset ? initial(k) : { ...s, key: k, status: 'loading', error: null }));
    try {
      const page = await apiGet<SearchResponse>(`/search${apiQuery(c, start)}`);
      if (id !== run.current) return;
      setState((s) => ({
        key: k,
        results: reset ? page.results : [...s.results, ...page.results],
        nextCursor: page.nextCursor,
        status: 'idle',
        error: null,
      }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchPage]);

  const loadMore = useCallback(() => {
    if (busy.current || state.nextCursor === null) return;
    void fetchPage(state.nextCursor, false);
  }, [fetchPage, state.nextCursor]);

  // After an error the list is whatever was loaded; retry repeats the page that failed.
  const retry = useCallback(() => {
    if (busy.current) return;
    const first = state.results.length === 0 || state.nextCursor === null;
    void fetchPage(first ? 0 : state.nextCursor!, first);
  }, [fetchPage, state.results.length, state.nextCursor]);

  const cur = state.key === key ? state : initial(key);
  return { results: cur.results, status: cur.status, error: cur.error, hasMore: cur.nextCursor !== null, loadMore, retry };
}
