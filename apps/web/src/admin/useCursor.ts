import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';

type CursorPage = { nextBefore: string | null };

/**
 * A newest-first list the server hands out by `before` cursor: the first page through `useResource`, later pages
 * appended by `loadMore` (resolves false on failure, for `Paged`). `replace` swaps one row after an action.
 */
export function useCursor<T extends { id: string }>(path: string, key: string) {
  const pick = (page: CursorPage) => (page as unknown as Record<string, T[]>)[key] ?? [];
  const { t } = useTranslation();
  const first = useResource<CursorPage>(path);
  const [extra, setExtra] = useState<{ path: string; rows: T[]; next: string | null } | null>(null);
  const [changed, setChanged] = useState<Map<string, T>>(new Map());
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const state = first.state;
  const own = extra?.path === path ? extra : null;
  const base = state.status === 'ready' ? pick(state.data) : [];
  const rows = [...base, ...(own?.rows ?? [])].map((r) => changed.get(r.id) ?? r);
  const next = own ? own.next : state.status === 'ready' ? state.data.nextBefore : null;

  const loadMore = async () => {
    if (next === null || loading) return false;
    setLoading(true);
    setMoreError(null);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const page = await apiGet<CursorPage>(`${path}${sep}before=${encodeURIComponent(next)}`);
      const got = pick(page);
      setExtra({ path, rows: [...(own?.rows ?? []), ...got], next: page.nextBefore });
      return got.length > 0;
    } catch (e) {
      setMoreError(errorMessage(e, t));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const replace = useCallback((row: T) => setChanged((m) => new Map(m).set(row.id, row)), []);

  return { state, reload: first.reload, rows, more: next !== null, loading, moreError, loadMore, replace };
}
