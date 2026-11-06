import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

const POLL_MS = 60_000;

/**
 * Calls `tick` every `ms` while the app is in the foreground, and straight away when it comes back to the
 * foreground, so a screen left open catches up as soon as someone looks at it.
 */
export function usePoll(tick: () => void, ms = POLL_MS): void {
  const latest = useRef(tick);
  latest.current = tick;

  useEffect(() => {
    const run = () => {
      if (AppState.currentState === 'active') latest.current();
    };
    const id = setInterval(run, ms);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') latest.current();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [ms]);
}
