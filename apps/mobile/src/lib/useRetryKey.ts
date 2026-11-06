import { useMemo, useRef } from 'react';
import { randomUUID } from 'expo-crypto';

/**
 * An Idempotency-Key for one write: the same request sent again (a retry after a dropped response)
 * reuses it, so the API answers with what the first one did instead of doing it twice. `done()` after
 * a success, so the next, identical write (a second cash amount of the same size) is a new one.
 */
export function useRetryKey() {
  const last = useRef<{ sig: string; key: string } | null>(null);
  return useMemo(
    () => ({
      keyFor(sig: string): string {
        if (last.current?.sig !== sig) last.current = { sig, key: randomUUID() };
        return last.current.key;
      },
      done() {
        last.current = null;
      },
    }),
    [],
  );
}
