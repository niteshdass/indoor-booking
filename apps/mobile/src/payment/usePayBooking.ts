import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiGet } from '../lib/api';
import type { PlayerBooking } from '../bookings/types';

export type BookingState = { status: 'loading' } | { status: 'ready'; booking: PlayerBooking } | { status: 'error'; error: unknown };

/**
 * The booking behind the pay screen, from `GET /me/bookings/:id`. Fetched on mount, on `refetch()` (after every
 * payment attempt) and whenever the app comes back to the foreground, since a payment may finish in the browser or a
 * bank app meanwhile. The latest request wins: an older one that lands late is ignored.
 */
export function usePayBooking(
  id: string,
  enabled: boolean,
): { state: BookingState; refetch(): Promise<PlayerBooking | null>; setBooking(booking: PlayerBooking): void } {
  const [state, setState] = useState<BookingState>({ status: 'loading' });
  const run = useRef(0);
  const live = useRef(true);

  const refetch = useCallback(async (): Promise<PlayerBooking | null> => {
    const mine = ++run.current;
    try {
      const res = await apiGet<{ booking: PlayerBooking }>(`/me/bookings/${encodeURIComponent(id)}`);
      if (!live.current || mine !== run.current) return null;
      setState({ status: 'ready', booking: res.booking });
      return res.booking;
    } catch (error) {
      if (!live.current || mine !== run.current) return null;
      // Keep showing a booking already on screen; only a first load turns into an error.
      setState((s) => (s.status === 'ready' ? s : { status: 'error', error }));
      return null;
    }
  }, [id]);

  /** Show a booking the server just returned (e.g. from a submit); any request still in flight is dropped. */
  const setBooking = useCallback((booking: PlayerBooking) => {
    run.current++;
    if (live.current) setState({ status: 'ready', booking });
  }, []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      run.current++;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refetch();
    });
    return () => sub.remove();
  }, [enabled, refetch]);

  return { state, refetch, setBooking };
}
