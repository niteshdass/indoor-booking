import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../lib/apiClient';

export type ResourceState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

/** The state plus the path it belongs to, so a path change never shows the previous path's data. */
type Tracked<T> = { path: string | null; state: ResourceState<T>; updatedAt: number | null; refreshError: unknown };

/**
 * GETs `path` and tracks it. A `null` path is idle. `reload()` refetches and keeps the current data on screen until
 * the new data arrives; `set()` replaces the data locally after a successful write. Responses for an old path are ignored.
 * With `keepOnError`, a failed reload keeps the data and reports the failure in `refreshError` instead.
 */
export function useResource<T>(
  path: string | null,
  opts: { keepOnError?: boolean } = {},
): {
  state: ResourceState<T>;
  reload(): void;
  set(data: T): void;
  /** When the data on screen was last loaded (ms). */
  updatedAt: number | null;
  /** Why the last reload failed while the old data stayed on screen; null once a reload succeeds. */
  refreshError: unknown;
} {
  const keep = opts.keepOnError ?? false;
  const [tracked, setTracked] = useState<Tracked<T>>({
    path,
    state: path === null ? { status: 'idle' } : { status: 'loading' },
    updatedAt: null,
    refreshError: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setTracked({ path, state: { status: 'idle' }, updatedAt: null, refreshError: null });
      return;
    }
    let live = true;
    setTracked((t) => (t.path === path ? t : { path, state: { status: 'loading' }, updatedAt: null, refreshError: null }));
    apiGet<T>(path)
      .then((data) => {
        if (live) setTracked({ path, state: { status: 'ready', data }, updatedAt: Date.now(), refreshError: null });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setTracked((t) =>
          keep && t.path === path && t.state.status === 'ready'
            ? { ...t, refreshError: error }
            : { path, state: { status: 'error', error }, updatedAt: null, refreshError: null },
        );
      });
    return () => {
      live = false;
    };
  }, [path, nonce, keep]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback(
    (data: T) => setTracked({ path, state: { status: 'ready', data }, updatedAt: Date.now(), refreshError: null }),
    [path],
  );

  // On the render right after a path change, before the effect runs, report the new path's initial state.
  const current = tracked.path === path;
  const state: ResourceState<T> = current ? tracked.state : path === null ? { status: 'idle' } : { status: 'loading' };
  return {
    state,
    reload,
    set,
    updatedAt: current ? tracked.updatedAt : null,
    refreshError: current ? tracked.refreshError : null,
  };
}
