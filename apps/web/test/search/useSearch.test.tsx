import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SearchResult } from '@booking/shared';
import { useSearch } from '../../src/search/useSearch';
import { EMPTY_CRITERIA, type Criteria } from '../../src/search/searchParams';
import { mockApi, type Call } from '../helpers/api';

afterEach(() => vi.unstubAllGlobals());

function venue(slug: string): SearchResult {
  return {
    slug,
    name: slug.toUpperCase(),
    address: 'Road 1',
    city: 'Dhaka',
    country: 'BD',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    location: { lat: 1, lng: 2 },
    photo: null,
    sports: ['futsal'],
    distanceMeters: null,
    date: '2026-10-25',
    fromPrice: 1000,
    nextFreeSlot: null,
  };
}
/** Holds the fetch calls (by call index) until the returned release() is called; they then go through to the mock. */
function gateFetch(held: (n: number) => boolean): () => void {
  const inner = globalThis.fetch;
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let n = 0;
  vi.stubGlobal('fetch', (...args: Parameters<typeof fetch>) => (held(n++) ? gate.then(() => inner(...args)) : inner(...args)));
  return open;
}
const cursorOf = (q: URLSearchParams) => Number(q.get('cursor'));

describe('useSearch', () => {
  it('keeps fetching while empty pages have a cursor', async () => {
    const pages: Record<number, unknown> = {
      0: { results: [], nextCursor: 100 },
      100: { results: [], nextCursor: 200 },
      200: { results: [venue('a')], nextCursor: null },
    };
    const api = mockApi([{ path: '/search', body: (c: Call) => pages[cursorOf(c.query)] }]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(api.calls.map((c) => cursorOf(c.query))).toEqual([0, 100, 200]);
    expect(result.current.results.map((r) => r.slug)).toEqual(['a']);
    expect(result.current.hasMore).toBe(false);
  });

  it('stops auto-following after 10 extra requests', async () => {
    const api = mockApi([{ path: '/search', body: (c: Call) => ({ results: [], nextCursor: cursorOf(c.query) + 100 }) }]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(api.calls).toHaveLength(11);
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore starts a fresh auto-follow budget and ignores calls while loading', async () => {
    const api = mockApi([{ path: '/search', body: (c: Call) => ({ results: [], nextCursor: cursorOf(c.query) + 100 }) }]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(api.calls).toHaveLength(22);
    expect(api.calls.map((c) => cursorOf(c.query))).toEqual(Array.from({ length: 22 }, (_, i) => i * 100));
  });

  it('loadMore appends next page', async () => {
    const full = Array.from({ length: 20 }, (_, i) => venue(`v${i}`));
    const api = mockApi([
      {
        path: '/search',
        body: (c: Call) =>
          cursorOf(c.query) === 0 ? { results: full, nextCursor: 20 } : { results: [venue('last')], nextCursor: null },
      },
    ]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(api.calls).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.results).toHaveLength(21));
    expect(result.current.results[20]!.slug).toBe('last');
    expect(result.current.hasMore).toBe(false);
    expect(api.calls.map((c) => cursorOf(c.query))).toEqual([0, 20]);
  });

  it('criteria change discards stale response', async () => {
    const real = mockApi([
      {
        path: '/search',
        body: (c: Call) => ({ results: [venue(c.query.get('sport') === 'padel' ? 'padel-venue' : 'x')], nextCursor: null }),
      },
    ]);
    const release = gateFetch((n) => n === 0);
    const { result, rerender } = renderHook(({ c }: { c: Criteria }) => useSearch(c), {
      initialProps: { c: EMPTY_CRITERIA },
    });
    rerender({ c: { ...EMPTY_CRITERIA, sport: 'padel' } });
    await waitFor(() => expect(result.current.results.map((r) => r.slug)).toEqual(['padel-venue']));
    release();
    await waitFor(() => expect(real.calls).toHaveLength(2)); // the stale request really completed
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.results.map((r) => r.slug)).toEqual(['padel-venue']);
  });

  it('criteria change mid-chain stops the old chain and writes nothing from it', async () => {
    const api = mockApi([
      {
        path: '/search',
        body: (c: Call) =>
          c.query.get('sport') === 'padel'
            ? { results: [venue('new')], nextCursor: null }
            : { results: [venue(`old${cursorOf(c.query)}`)].slice(0, 0), nextCursor: cursorOf(c.query) + 100 },
      },
    ]);
    const release = gateFetch((n) => n === 1); // the old chain's second request
    const { result, rerender } = renderHook(({ c }: { c: Criteria }) => useSearch(c), {
      initialProps: { c: EMPTY_CRITERIA },
    });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    rerender({ c: { ...EMPTY_CRITERIA, sport: 'padel' } });
    await waitFor(() => expect(result.current.results.map((r) => r.slug)).toEqual(['new']));
    release();
    await waitFor(() => expect(api.calls).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 20));
    const old = api.calls.filter((c) => c.query.get('sport') === null);
    expect(old.map((c) => cursorOf(c.query))).toEqual([0, 100]);
    expect(api.calls).toHaveLength(3);
    expect(result.current.results.map((r) => r.slug)).toEqual(['new']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.status).toBe('idle');
  });

  it('unmounting mid-chain stops further requests', async () => {
    const api = mockApi([{ path: '/search', body: (c: Call) => ({ results: [], nextCursor: cursorOf(c.query) + 100 }) }]);
    const release = gateFetch((n) => n === 1);
    const { unmount } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(api.calls).toHaveLength(1));
    unmount();
    release();
    await waitFor(() => expect(api.calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls).toHaveLength(2);
  });

  it('under StrictMode the initial load is fetched once', async () => {
    const api = mockApi([{ path: '/search', body: { results: [venue('a')], nextCursor: null } }]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(api.calls).toHaveLength(1);
    expect(result.current.results).toHaveLength(1);
  });

  it('rate limited shows error, and retry resumes from the failed cursor keeping results', async () => {
    const full = Array.from({ length: 20 }, (_, i) => venue(`v${i}`));
    let failNext = true;
    const api = mockApi([
      {
        path: '/search',
        body: (c: Call) => {
          if (cursorOf(c.query) === 0) return { results: full, nextCursor: 20 };
          if (failNext) {
            failNext = false;
            return { status: 429, body: { error: { code: 'rate_limited', message: 'slow down' } } };
          }
          return { results: [venue('last')], nextCursor: null };
        },
      },
    ]);
    const { result } = renderHook(() => useSearch(EMPTY_CRITERIA));
    await waitFor(() => expect(result.current.status).toBe('idle'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect((result.current.error as { code: string }).code).toBe('rate_limited');
    expect(result.current.results).toHaveLength(20);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.results).toHaveLength(21);
    expect(api.calls.map((c) => cursorOf(c.query))).toEqual([0, 20, 20]);
  });
});
