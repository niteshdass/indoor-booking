import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { apiDelete, apiGet } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { Closure, OwnerTurf } from '../types';
import { useResource } from '../useResource';
import { ClosureForm } from './ClosureForm';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import styles from './overrides.module.css';

/** Turfs of every venue, keyed by venue id; a venue whose turfs fail to load is simply missing. */
function useTurfsByVenue(): Record<string, OwnerTurf[]> {
  const { ownerId, venues } = useOwner();
  const key = venues.map((v) => v.id).join(',');
  const [byVenue, setByVenue] = useState<Record<string, OwnerTurf[]>>({});
  useEffect(() => {
    let live = true;
    const ids = key === '' ? [] : key.split(',');
    Promise.allSettled(ids.map((id) => apiGet<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(id)}/turfs`)))).then((results) => {
      if (!live) return;
      const next: Record<string, OwnerTurf[]> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[ids[i]!] = r.value.turfs;
      });
      setByVenue(next);
    });
    return () => {
      live = false;
    };
  }, [ownerId, key]);
  return byVenue;
}

/** Closures across the owner, a venue or a turf, filtered by venue and turf (`?venue=&turf=`). */
export function ClosuresPage() {
  const { t, i18n } = useTranslation();
  const { ownerId, venues, membership, can } = useOwner();
  useOwnerTitle(t('owner.nav.closures'));
  const [params, setParams] = useSearchParams();
  const turfsByVenue = useTurfsByVenue();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Closure | null>(null);

  const ownerWide = can('settings.edit') && membership.venueIds === 'all';
  const canDelete = (c: Closure) => (c.venueId === null ? ownerWide : can('slot.override'));
  const canAdd = ownerWide || can('slot.override');

  const venueId = venues.find((v) => v.id === params.get('venue'))?.id ?? '';
  const turfId = (turfsByVenue[venueId] ?? []).find((x) => x.id === params.get('turf'))?.id ?? '';
  const query = new URLSearchParams();
  if (venueId) query.set('venueId', venueId);
  if (turfId) query.set('turfId', turfId);
  const qs = query.toString();
  const { state, reload } = useResource<{ closures: Closure[] }>(ownerPath(ownerId, `/closures${qs ? `?${qs}` : ''}`));

  const setFilter = (next: { venue: string; turf: string }) =>
    setParams(
      {
        ...(next.venue ? { venue: next.venue } : {}),
        ...(next.turf ? { turf: next.turf } : {}),
      },
      { replace: true },
    );

  const turfName = useMemo(() => {
    const names = new Map<string, string>();
    Object.values(turfsByVenue).forEach((list) => list.forEach((x) => names.set(x.id, x.name)));
    return names;
  }, [turfsByVenue]);
  const scopeLabel = (c: Closure) => {
    if (c.venueId === null) return t('owner.closures.scopeOwner');
    const venueName = venues.find((v) => v.id === c.venueId)?.name ?? t('owner.closures.venue');
    if (c.turfId === null) return venueName;
    return `${venueName} · ${turfName.get(c.turfId) ?? t('owner.closures.turf')}`;
  };
  const range = (c: Closure) =>
    c.from === c.to
      ? formatDate(c.from, 'UTC', i18n.language)
      : `${formatDate(c.from, 'UTC', i18n.language)} – ${formatDate(c.to, 'UTC', i18n.language)}`;

  const remove = async () => {
    if (!removing) return;
    await apiDelete(ownerPath(ownerId, `/closures/${encodeURIComponent(removing.id)}`));
    setRemoving(null);
    reload();
  };

  return (
    <div className={styles.stack}>
      <p className={styles.muted}>{t('owner.closures.intro')}</p>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <Select
            label={t('owner.closures.venue')}
            value={venueId}
            options={[{ value: '', label: t('owner.closures.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
            onChange={(e) => setFilter({ venue: e.target.value, turf: '' })}
          />
          {venueId && (
            <Select
              label={t('owner.closures.turf')}
              value={turfId}
              options={[{ value: '', label: t('owner.closures.allTurfs') }, ...(turfsByVenue[venueId] ?? []).map((x) => ({ value: x.id, label: x.name }))]}
              onChange={(e) => setFilter({ venue: venueId, turf: e.target.value })}
            />
          )}
        </div>
        {canAdd && <Button onClick={() => setAdding(true)}>{t('owner.closures.add')}</Button>}
      </div>
      {state.status === 'error' && (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      )}
      {(state.status === 'loading' || state.status === 'idle') && <Skeleton kind="table" label={t('common.loading')} />}
      {state.status === 'ready' &&
        (state.data.closures.length === 0 ? (
          <EmptyState sport="badminton" title={t('owner.closures.empty')} />
        ) : (
          <Paged items={state.data.closures} resetKey={`${venueId}:${turfId}`}>
            {(rows) => (
              <Table caption={t('owner.closures.title')}>
                <thead>
                  <tr>
                    <th>{t('owner.closures.col.scope')}</th>
                    <th>{t('owner.closures.col.range')}</th>
                    <th>{t('owner.closures.col.reason')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>{scopeLabel(c)}</td>
                      <td className={styles.num}>{range(c)}</td>
                      <td>{c.reason ?? t('owner.override.none')}</td>
                      <td>
                        {canDelete(c) && (
                          <Button variant="ghost" size="sm" onClick={() => setRemoving(c)}>
                            {t('owner.closures.delete')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Paged>
        ))}
      {canAdd && <ClosureForm open={adding} onClose={() => setAdding(false)} onCreated={reload} turfsByVenue={turfsByVenue} />}
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('owner.closures.deleteTitle')}
        body={t('owner.closures.deleteBody')}
        confirmLabel={t('owner.closures.deleteConfirm')}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </div>
  );
}
