import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/apiClient';

export type ResourceState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

/** The state plus the path it belongs to, so a path change never shows the previous path's data. */
type Tracked<T> = { path: string | null; state: ResourceState<T> };

/**
 * GETs `path` and tracks it. A `null` path is idle. `reload()` refetches and keeps the current data on screen until
 * the new data arrives; `set()` replaces the data locally after a successful write. Responses for an old path are ignored.
 */
export function useResource<T>(path: string | null): {
  state: ResourceState<T>;
  reload(): void;
  set(data: T): void;
} {
  const [tracked, setTracked] = useState<Tracked<T>>({ path, state: path === null ? { status: 'idle' } : { status: 'loading' } });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setTracked({ path, state: { status: 'idle' } });
      return;
    }
    let live = true;
    setTracked((t) => (t.path === path ? t : { path, state: { status: 'loading' } }));
    apiGet<T>(path)
      .then((data) => {
        if (live) setTracked({ path, state: { status: 'ready', data } });
      })
      .catch((error: unknown) => {
        if (live) setTracked({ path, state: { status: 'error', error } });
      });
    return () => {
      live = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((data: T) => setTracked({ path, state: { status: 'ready', data } }), [path]);

  // On the render right after a path change, before the effect runs, report the new path's initial state.
  const state: ResourceState<T> =
    tracked.path === path ? tracked.state : path === null ? { status: 'idle' } : { status: 'loading' };
  return { state, reload, set };
}
