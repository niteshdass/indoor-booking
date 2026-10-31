import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { BookingStatus, SeriesGameJson, SeriesJson } from '@booking/shared';
import { BookingStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Paged } from '../../components/ui/Pagination';
import { Table } from '../../components/ui/Table';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatTime, money } from '../../lib/format';
import { SeriesStatusBadge } from '../../series/SeriesBadge';
import { OwnerCancelDialog } from '../bookings/OwnerCancelDialog';
import { ReasonDialog } from '../bookings/ReasonDialog';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { OwnerTurf } from '../types';
import { useResource } from '../useResource';
import { dateRange, patternSummary, seriesCustomer } from './seriesText';
import styles from './series.module.css';

/** The statuses a staff member can still cancel a game from. */
const CANCELLABLE: readonly BookingStatus[] = ['pending', 'awaiting_payment', 'confirmed'];

/** One series: pattern, customer, games, skipped dates and the answer / cancel actions. */
export function SeriesDetailPage() {
  const { seriesId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { ownerId, venues, can } = useOwner();
  const lang = i18n.language;
  useOwnerTitle(t('series.title'));
  const { state, reload, set } = useResource<{ series: SeriesJson }>(ownerPath(ownerId, `/series/${encodeURIComponent(seriesId)}`));
  const series = state.status === 'ready' ? state.data.series : null;
  const turfs = useResource<{ turfs: OwnerTurf[] }>(
    series ? ownerPath(ownerId, `/venues/${encodeURIComponent(series.venueId)}/turfs`) : null,
  );
  const [declineOpen, setDeclineOpen] = useState(false);
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  const [cancelGameId, setCancelGameId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [kept, setKept] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const back = (
    <Link to={`/owner/${encodeURIComponent(ownerId)}/series`} className={styles.link}>
      {t('series.owner.back')}
    </Link>
  );

  if (state.status === 'error') {
    if (state.error instanceof ApiError && state.error.status === 404) {
      return (
        <div className={styles.page}>
          <p className={styles.muted}>{t('series.owner.notFound')}</p>
          {back}
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" icon="refresh" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
        {back}
      </div>
    );
  }
  if (!series) return <Skeleton kind="detail" label={t('common.loading')} />;

  const venue = venues.find((v) => v.id === series.venueId);
  const tz = venue?.timezone ?? 'UTC';
  const turfList = turfs.state.status === 'ready' ? turfs.state.data.turfs : [];
  const turf = turfList.find((x) => x.id === series.turfId);
  const base = ownerPath(ownerId, `/series/${encodeURIComponent(series.id)}`);
  const fmt = (n: number) => money(n, series.currency, lang);
  const games = [...series.games].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const now = Date.now();
  const future = games.filter((g) => CANCELLABLE.includes(g.status) && Date.parse(g.startAt) > now);

  const canAnswer = series.status === 'requested' && can('booking.confirm');
  const canCancelFuture = series.status === 'active' && can('booking.cancel') && future.length > 0;
  // The API refuses per-game actions while the request is open.
  const canCancelGame = series.status === 'active' && can('booking.cancel');

  /** POSTs one series action. One at a time; a 409 means the series changed under us, so reload. */
  const post = async <T extends { series: SeriesJson }>(action: string, body: object = {}): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      return await apiPost<T>(`${base}/${action}`, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) reload();
      throw e;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const accept = () => {
    setKept(null);
    post('accept').then(
      (res) => res && set({ series: res.series }),
      (e: unknown) => setError(e),
    );
  };

  const keptDates = (ids: { id: string }[]) =>
    ids.map((k) => series.games.find((g) => g.id === k.id)).filter((g): g is SeriesGameJson => g !== undefined).map((g) => formatDate(g.businessDate, 'UTC', lang));

  return (
    <div className={styles.page}>
      {back}
      <header className={styles.head}>
        <h1 className={styles.title}>{seriesCustomer(series, t)}</h1>
        <SeriesStatusBadge status={series.status} />
        {(canAnswer || canCancelFuture) && (
          <div className={styles.headActions}>
            {canAnswer && (
              <>
                <Button icon="check" disabled={pending} onClick={accept}>
                  {t('series.owner.accept')}
                </Button>
                <Button variant="secondary" icon="ban" disabled={pending} onClick={() => setDeclineOpen(true)}>
                  {t('series.owner.decline')}
                </Button>
              </>
            )}
            {canCancelFuture && (
              <Button variant="danger" icon="ban" disabled={pending} onClick={() => setCancelAllOpen(true)}>
                {t('series.owner.cancelFuture')}
              </Button>
            )}
          </div>
        )}
      </header>

      {series.status === 'requested' && series.respondBy && (
        <Alert tone="warning">{t('series.owner.answerBy', { when: formatDateTime(series.respondBy, tz, lang) })}</Alert>
      )}
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {kept !== null && kept.length > 0 && <Alert tone="warning">{t('series.owner.kept', { dates: kept.join(', ') })}</Alert>}

      <section className={`${styles.card} ${styles.compact}`} aria-label={t('series.owner.details')}>
        <dl className={styles.facts}>
          {series.guest?.phone && <Fact label={t('owner.bookings.phone')}>{series.guest.phone}</Fact>}
          <Fact label={t('owner.venue')}>{venue?.name ?? '—'}</Fact>
          <Fact label={t('owner.bookings.turf')}>{turf?.name ?? '—'}</Fact>
          <Fact label={t('series.owner.schedule')}>{patternSummary(series, turf, lang)}</Fact>
          <Fact label={t('series.owner.dates')}>{dateRange(series, lang)}</Fact>
          <Fact label={t('series.owner.games')}>{series.games.length}</Fact>
          {series.declineReason && <Fact label={t('owner.bookings.reason.recorded')}>{series.declineReason}</Fact>}
        </dl>
        {series.skipped.length > 0 && (
          <div className={`${styles.fact} ${styles.group}`}>
            <h2 className={styles.groupLabel}>{t('series.owner.skippedTitle')}</h2>
            <ul className={styles.skippedList}>
              {series.skipped.map((s) => (
                <li key={s.date}>
                  {formatDate(s.date, 'UTC', lang)} · {t(`series.reason.${s.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles.page} aria-label={t('series.owner.games')}>
        <h2 className={styles.subheading}>{t('series.owner.games')}</h2>
        {games.length === 0 ? (
          <EmptyState size="sm" title={t('series.owner.noGames')} />
        ) : (
          <Paged items={games} pageSize={10}>
            {(rows) => (
              <Table caption={t('series.owner.games')} className={`${styles.grid} ${styles.dense}`}>
                <thead>
                  <tr>
                    <th>{t('owner.bookings.date')}</th>
                    <th>{t('owner.bookings.time')}</th>
                    <th>{t('owner.bookings.status')}</th>
                    <th>{t('owner.bookings.paid')}</th>
                    <th>{t('owner.bookings.reference')}</th>
                    {canCancelGame && <th className={styles.end}>{t('owner.bookings.actions.title')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id}>
                      <td className={styles.nums}>{formatDate(g.businessDate, 'UTC', lang)}</td>
                      <td className={styles.nums}>
                        {formatTime(g.startAt, tz, lang)} – {formatTime(g.endAt, tz, lang)}
                      </td>
                      <td>
                        <BookingStatusBadge status={g.status} />
                      </td>
                      <td className={styles.nums}>{fmt(g.amountPaid)}</td>
                      <td>
                        <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(g.id)}`} className={styles.ref}>
                          {g.reference}
                        </Link>
                      </td>
                      {canCancelGame && (
                        <td className={styles.end}>
                          {CANCELLABLE.includes(g.status) && (
                            <Button size="sm" variant="ghost" icon="ban" disabled={pending} onClick={() => setCancelGameId(g.id)}>
                              {t('series.owner.cancelGame')}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Paged>
        )}
      </section>

      <ReasonDialog
        open={declineOpen}
        title={t('series.owner.declineTitle')}
        confirmLabel={t('series.owner.decline')}
        tone="danger"
        onClose={() => setDeclineOpen(false)}
        onSubmit={async (reason) => {
          const res = await post('decline', reason ? { reason } : {});
          if (!res) return;
          setDeclineOpen(false);
          set({ series: res.series });
        }}
      />
      <ReasonDialog
        open={cancelAllOpen}
        title={t('series.owner.cancelFutureTitle', { count: future.length })}
        confirmLabel={t('series.owner.cancelFutureConfirm')}
        tone="danger"
        onClose={() => setCancelAllOpen(false)}
        onSubmit={async (reason) => {
          const res = await post<{ series: SeriesJson; cancelled: string[]; kept: { id: string; code: string }[] }>(
            'cancel-future',
            reason ? { reason } : {},
          );
          if (!res) return;
          setCancelAllOpen(false);
          setKept(keptDates(res.kept));
          set({ series: res.series });
        }}
      />
      <OwnerCancelDialog
        bookingId={cancelGameId ?? ''}
        open={cancelGameId !== null}
        onClose={() => setCancelGameId(null)}
        onCancelled={() => {
          setCancelGameId(null);
          reload();
        }}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}
