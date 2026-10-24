import { useEffect, useState } from 'react';

const TICK_MS = 1000;

function remaining(until: string | null): number {
  if (!until) return 0;
  const t = Date.parse(until);
  return Number.isNaN(t) ? 0 : Math.max(0, t - Date.now());
}

/** Milliseconds left until `until`, ticking every second and never below zero. */
export function useCountdown(until: string | null): { msLeft: number; expired: boolean } {
  const [msLeft, setMsLeft] = useState(() => remaining(until));
  useEffect(() => {
    setMsLeft(remaining(until));
    if (!until) return;
    const id = setInterval(() => {
      const left = remaining(until);
      setMsLeft(left);
      if (left <= 0) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [until]);
  return { msLeft, expired: until !== null && msLeft <= 0 };
}
