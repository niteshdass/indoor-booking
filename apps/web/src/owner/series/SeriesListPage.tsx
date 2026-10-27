import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SERIES_STATUSES, type SeriesJson, type SeriesStatus } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { apiGet } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { SeriesStatusBadge } from '../../series/SeriesBadge';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { dateRange, patternSummary, seriesCustomer } from './seriesText';
import styles from './series.module.css';

type Page = { series: SeriesJson[]; nextBefore: string | null };
type Load =
  | { status: 'loading' }
  | { status: 'ready'; items: SeriesJson[]; nextBefore: string | null; more: boolean; moreError: unknown }
  | { status: 'error'; error: unknown };

/** The owner's series for one venue, filtered by status through the URL, 50 at a time. */
export function SeriesListPage() {
  const { t } = useTranslation();
  const [venue] = useVenueParam();
  useOwnerTitle(t('series.title'));
  if (!venue) return <EmptyState title={t('owner.today.noVenues')} />;
  return <SeriesVenue venue={venue} />;
}

function SeriesVenue({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { can } = useOwner();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status = SERIES_STATUSES.find((s) => s === raw) ?? null;

  const setStatus = (next: SeriesStatus | null) =>
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        if (next) copy.set('status', next);
        else copy.delete('status');
        return copy;
      },
      { replace: true },
    );

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <VenueSelect />
          <Select
            label={t('owner.bookings.status')}
            value={status ?? ''}
            onChange={(e) => setStatus(SERIES_STATUSES.find((s) => s === e.target.value) ?? null)}
            options={[
              { value: '', label: t('owner.bookings.allStatuses') },
              ...SERIES_STATUSES.map((s) => ({ value: s, label: t(`series.status.${s}`) })),
            ]}
          />
        </div>
        {can('booking.create') && (
          <Button onClick={() => navigate(`new?venue=${encodeURIComponent(venue.id)}`)}>{t('series.owner.newSeries')}</Button>
        )}
      </div>
      <SeriesRows key={`${venue.id}|${status ?? ''}`} venue={venue} status={status} />
    </div>
  );
}

function SeriesRows({ venue, status }: { venue: OwnerVenue; status: SeriesStatus | null }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const lang = i18n.language;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  const turfList = turfs.state.status === 'ready' ? turfs.state.data.turfs : [];

  const pathFor = (before?: string) => {
    const q = new URLSearchParams({ venueId: venue.id });
    if (status) q.set('status', status);
    if (before) q.set('before', before);
    return ownerPath(ownerId, `/series?${q.toString()}`);
  };

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    apiGet<Page>(pathFor())
      .then((p) => live && setLoad({ status: 'ready', items: p.series, nextBefore: p.nextBefore, more: false, moreError: null }))
      .catch((error: unknown) => live && setLoad({ status: 'error', error }));
    return () => {
      live = false;
    };
  }, [attempt]);

  const showMore = async () => {
    if (load.status !== 'ready' || load.nextBefore === null || load.more) return;
    const { items, nextBefore } = load;
    setLoad({ ...load, more: true, moreError: null });
    try {
      const p = await apiGet<Page>(pathFor(nextBefore));
      setLoad({ status: 'ready', items: [...items, ...p.series], nextBefore: p.nextBefore, more: false, moreError: null });
    } catch (e) {
      setLoad({ status: 'ready', items, nextBefore, more: false, moreError: e });
    }
  };

  if (load.status === 'loading') return <Skeleton kind="table" label={t('common.loading')} />;
  if (load.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(load.error, t)}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (load.items.length === 0) return <EmptyState title={t('series.owner.empty')} />;

  return (
    <>
      <Table caption={t('series.title')} className={styles.grid}>
        <thead>
          <tr>
            <th>{t('owner.bookings.customer')}</th>
            <th>{t('owner.bookings.turf')}</th>
            <th>{t('series.owner.schedule')}</th>
            <th>{t('series.owner.dates')}</th>
            <th>{t('series.owner.games')}</th>
            <th>{t('owner.bookings.status')}</th>
          </tr>
        </thead>
        <tbody>
          {load.items.map((s) => {
            const turf = turfList.find((x) => x.id === s.turfId);
            return (
              <tr key={s.id}>
                <td>
                  <Link to={encodeURIComponent(s.id)} className={styles.link}>
                    {seriesCustomer(s, t)}
                  </Link>
                </td>
                <td>{turf?.name ?? '—'}</td>
                <td className={styles.nums}>{patternSummary(s, turf, lang)}</td>
                <td>{dateRange(s, lang)}</td>
                <td className={styles.nums}>{s.games.length}</td>
                <td>
                  <SeriesStatusBadge status={s.status} />
                  {s.status === 'requested' && s.respondBy && (
                    <span className={styles.sub}>{t('series.owner.answerBy', { when: formatDateTime(s.respondBy, venue.timezone, lang) })}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {load.moreError !== null && <Alert tone="danger">{errorMessage(load.moreError, t)}</Alert>}
      {load.nextBefore !== null && (
        <div className={styles.buttons}>
          <Button variant="secondary" loading={load.more} onClick={() => void showMore()}>
            {t('series.owner.showMore')}
          </Button>
        </div>
      )}
    </>
  );
}
