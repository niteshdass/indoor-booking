import { useCallback, useRef, useState } from 'react';
import { ApiError, apiPost } from '../../lib/api';

/**
 * One write at a time (a ref, because state lags a fast double tap). Failures land in `error`; a 409 means the
 * booking changed under us, so `onConflict` asks the screen to reload it. Resolves to null when it did not run or failed.
 */
export function usePost(onConflict?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inflight = useRef(false);
  const conflict = useRef(onConflict);
  conflict.current = onConflict;

  const post = useCallback(async <T,>(path: string, body: object): Promise<T | null> => {
    if (inflight.current) return null;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await apiPost<T>(path, body);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) conflict.current?.();
      return null;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);

  return { post, busy, error, setError, inflight };
}
