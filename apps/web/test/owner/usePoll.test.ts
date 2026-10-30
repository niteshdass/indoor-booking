import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNewIds, usePoll } from '../../src/owner/usePoll';

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePoll', () => {
  it('usePoll ticks every interval while visible', () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick));
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('usePoll skips ticks while hidden and ticks on becoming visible', () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick));
    visibility = 'hidden';
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('usePoll ticks when the browser comes back online', () => {
    const tick = vi.fn();
    renderHook(() => usePoll(tick));
    window.dispatchEvent(new Event('online'));
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('usePoll stops when unmounted', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePoll(tick));
    unmount();
    vi.advanceTimersByTime(60_000);
    window.dispatchEvent(new Event('online'));
    expect(tick).not.toHaveBeenCalled();
  });
});

describe('useNewIds', () => {
  it('useNewIds marks only ids missing from the previous list', () => {
    const { result, rerender } = renderHook(({ ids }) => useNewIds(ids), { initialProps: { ids: ['a'] } });
    expect([...result.current]).toEqual([]);
    rerender({ ids: ['a', 'b'] });
    expect([...result.current]).toEqual(['b']);
  });
});
