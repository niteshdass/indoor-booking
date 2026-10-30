import { useEffect, useRef } from 'react';

const POLL_MS = 60_000;

/**
 * Calls `tick` every `ms` while the tab is visible, and straight away when the tab becomes visible again or the
 * browser comes back online, so a page left open catches up as soon as someone looks at it.
 */
export function usePoll(tick: () => void, ms = POLL_MS): void {
  const latest = useRef(tick);
  latest.current = tick;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'hidden') latest.current();
    };
    const id = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('online', run);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('online', run);
    };
  }, [ms]);
}

const NONE: ReadonlySet<string> = new Set();

/** Ids that were not in the previous list; empty for the first list. Stable until the list itself changes. */
export function useNewIds(ids: string[]): ReadonlySet<string> {
  const key = ids.join('\n');
  const seen = useRef<{ key: string; ids: Set<string>; fresh: ReadonlySet<string> } | null>(null);
  if (seen.current === null) seen.current = { key, ids: new Set(ids), fresh: NONE };
  else if (seen.current.key !== key) {
    const prev = seen.current.ids;
    const fresh = ids.filter((id) => !prev.has(id));
    seen.current = { key, ids: new Set(ids), fresh: fresh.length ? new Set(fresh) : NONE };
  }
  return seen.current.fresh;
}
