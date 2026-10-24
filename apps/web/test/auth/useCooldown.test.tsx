import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCooldown } from '../../src/auth/useCooldown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCooldown', () => {
  it('is idle until started', () => {
    const { result } = renderHook(() => useCooldown(3));
    expect(result.current.left).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start() counts down from seconds to 0 and stops', () => {
    const { result } = renderHook(() => useCooldown(3));
    act(() => result.current.start());
    expect(result.current.left).toBe(3);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.left).toBe(2);
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.left).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.left).toBe(0);
  });

  it('start(5) overrides the default and restarts', () => {
    const { result } = renderHook(() => useCooldown(3));
    act(() => result.current.start(5));
    expect(result.current.left).toBe(5);
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.left).toBe(3);
    act(() => result.current.start(5));
    expect(result.current.left).toBe(5);
  });

  it('leaves no timer running after unmount', () => {
    const { result, unmount } = renderHook(() => useCooldown(3));
    act(() => result.current.start());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
