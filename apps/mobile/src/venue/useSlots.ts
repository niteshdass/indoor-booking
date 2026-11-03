import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlotDay } from '@booking/shared';
import { apiGet } from '../lib/api';

type State = { key: string; status: 'loading' | 'ready' | 'error'; day: SlotDay | null; error: unknown };

/**
 * One court-day of slots. Moving to another court or date drops the old day at once, and an answer that arrives for a
 * court-day the player has left is ignored. `retry` and `refresh` load the same court-day again.
 */
export function useSlots(slug: string, turfId: string | undefined, date: string): State & { retry(): void } {
  const key = turfId ? `${turfId}|${date}` : '';
  const [state, setState] = useState<State>({ key, status: 'loading', day: null, error: null });
  const run = useRef(0);

  const load = useCallback(() => {
    if (!turfId) return;
    const id = ++run.current;
    setState({ key: `${turfId}|${date}`, status: 'loading', day: null, error: null });
    apiGet<{ day: SlotDay }>(`/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/slots?date=${date}`).then(
      (r) => id === run.current && setState({ key: `${turfId}|${date}`, status: 'ready', day: r.day, error: null }),
      (error: unknown) => id === run.current && setState({ key: `${turfId}|${date}`, status: 'error', day: null, error }),
    );
  }, [slug, turfId, date]);

  useEffect(() => {
    load();
    return () => {
      run.current++;
    };
  }, [load]);

  // Render before the effect has started the new load: never show the previous court-day under the new tab.
  return state.key === key ? { ...state, retry: load } : { key, status: 'loading', day: null, error: null, retry: load };
}
