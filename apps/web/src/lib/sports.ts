import { useEffect, useState } from 'react';
import { SPORTS, type Sport, type SportsJson } from '@booking/shared';
import { apiGet } from './apiClient';

let cached: Sport[] | null = null;
let loading: Promise<Sport[]> | null = null;

/** The sports the platform offers, in the admin's order; fetched once per page, the full catalog until then or on failure. */
function loadSports(): Promise<Sport[]> {
  loading ??= apiGet<SportsJson>('/sports').then(
    (r) => (cached = r.sports),
    () => {
      loading = null; // try again on the next mount
      return [...SPORTS];
    },
  );
  return loading;
}

/** Tests, and the admin after a save: forget the cached list. */
export function resetSports(): void {
  cached = null;
  loading = null;
}

/**
 * The enabled sports, with `keep` added at the end when they are switched off, so a
 * form never drops a sport it already holds (a turf's sports, the sport being searched).
 */
export function useSports(keep: readonly Sport[] = []): Sport[] {
  const [sports, setSports] = useState<Sport[]>(() => cached ?? [...SPORTS]);
  useEffect(() => {
    let live = true;
    void loadSports().then((s) => live && setSports(s));
    return () => {
      live = false;
    };
  }, []);
  const extra = keep.filter((s) => !sports.includes(s));
  return extra.length > 0 ? [...sports, ...extra] : sports;
}
