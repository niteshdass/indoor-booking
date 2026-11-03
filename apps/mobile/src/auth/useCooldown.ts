import { useCallback, useEffect, useState } from 'react';

/** Counts down from `seconds` (or from the argument of `start`) to 0, once per second. Idle (0) until started. */
export function useCooldown(seconds: number): { left: number; start(sec?: number): void } {
  const [left, setLeft] = useState(0);
  const running = left > 0;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback((sec?: number) => setLeft(Math.max(0, Math.floor(sec ?? seconds))), [seconds]);
  return { left, start };
}
