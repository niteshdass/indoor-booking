import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Calls `fn` each time the screen comes back into focus, but not on the first focus (the screen loads its own data
 * when it mounts). Tabs stay mounted, so without this a tab shows what it loaded when it was first opened.
 */
export function useRefocus(fn: () => void): void {
  const latest = useRef(fn);
  latest.current = fn;
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!seen.current) {
        seen.current = true;
        return;
      }
      latest.current();
    }, []),
  );
}
