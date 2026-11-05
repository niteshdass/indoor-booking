import { SPORTS, type Sport, type SportsJson } from '@booking/shared';
import { useResource } from '../../lib/useResource';

/** The sports the platform offers (full catalogue until loaded or on failure), plus `keep` so a court never drops one it holds. */
export function useSports(keep: readonly Sport[] = []): Sport[] {
  const { state } = useResource<SportsJson>('/sports');
  const sports = state.status === 'ready' ? state.data.sports : [...SPORTS];
  const extra = keep.filter((s) => !sports.includes(s));
  return extra.length > 0 ? [...sports, ...extra] : sports;
}
