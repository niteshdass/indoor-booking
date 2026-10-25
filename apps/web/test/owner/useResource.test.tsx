import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useResource } from '../../src/owner/useResource';
import { mockApi, type Call } from '../helpers/api';

afterEach(() => vi.unstubAllGlobals());

describe('useResource', () => {
  it('loads, reloads keeping data, and set replaces data', async () => {
    const { calls } = mockApi([{ path: '/things', body: (_c: Call, n: number) => ({ n }) }]);
    const { result } = renderHook(() => useResource<{ n: number }>('/things'));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: { n: 0 } }));

    act(() => result.current.reload());
    expect(result.current.state).toEqual({ status: 'ready', data: { n: 0 } });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: { n: 1 } }));
    expect(calls).toHaveLength(2);

    act(() => result.current.set({ n: 9 }));
    expect(result.current.state).toEqual({ status: 'ready', data: { n: 9 } });
  });

  it('ignores a stale response after the path changes', async () => {
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseA = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/a')) await gate;
        return new Response(JSON.stringify({ id: path.endsWith('/a') ? 'a' : 'b' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { result, rerender } = renderHook(({ p }) => useResource<{ id: string }>(p), { initialProps: { p: '/a' } });
    rerender({ p: '/b' });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: { id: 'b' } }));
    await act(async () => {
      releaseA();
      await gate;
    });
    expect(result.current.state).toEqual({ status: 'ready', data: { id: 'b' } });
  });

  it('reports errors', async () => {
    mockApi([{ path: '/bad', status: 404, body: { error: { code: 'not_found', message: 'x' } } }]);
    const { result } = renderHook(() => useResource('/bad'));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  it('a null path stays idle and does not fetch', async () => {
    const { calls } = mockApi([]);
    const { result } = renderHook(() => useResource(null));
    expect(result.current.state).toEqual({ status: 'idle' });
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });
});
