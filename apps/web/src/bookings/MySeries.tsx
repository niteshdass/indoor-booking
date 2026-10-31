import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatTime } from '../lib/format';
import { SeriesStatusBadge } from '../series/SeriesBadge';
import { nextGames } from '../series/nextGames';
import type { PlayerSeries, SeriesJson } from '../series/types';
import { weekdayList } from '../series/weekdays';
import { BookingStatusBadge } from './BookingStatusBadge';
import styles from './MySeries.module.css';

type CancelResult = { series: SeriesJson; cancelled: string[]; kept: { id: string; code: string }[] };

/** The player's weekly series, one card each. `onChanged` runs after an action so the page can reload. */
export function MySeries({ series, onChanged }: { series: PlayerSeries[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const { hash } = useLocation();
  // A series badge links here with #series-<id>; scroll to that card once the list is in.
  useEffect(() => {
    if (hash.startsWith('#series-')) document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, series.length]);
  if (series.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="my-series-title">
      <h2 id="my-series-title" className={styles.heading}>
        {t('series.player.myTitle')}
      </h2>
      <ul className={styles.list}>
        {series.map((s) => (
          <li key={s.id}>
            <SeriesCard series={s} onChanged={onChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SeriesCard({ series, onChanged }: { series: PlayerSeries; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const tz = series.venue.timezone || 'UTC';
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ cancelled: number; kept: string[] } | null>(null);
  const busy = useRef(false);

  const games = [...series.games].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const now = Date.now();
  const next = nextGames(series.games, now);
  const cancellable = next.filter((g) => Date.parse(g.startAt) > now);
  const first = games[0];
  const canWithdraw = series.status === 'requested';
  const canCancel = series.status === 'active' && cancellable.length > 0;
  const hasFoot = next.length > 0 || series.skipped.length > 0 || canWithdraw || canCancel;
  const time = first
    ? `${formatTime(first.startAt, tz, lang)} – ${formatTime(first.endAt, tz, lang)}`
    : series.pattern.startTime;

  const act = async <T,>(path: string, done: (res: T) => void) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      done(await apiPost<T>(`/me/series/${encodeURIComponent(series.id)}/${path}`, {}));
    } catch (e) {
      setError(e);
    } finally {
      // Reload either way: after a 409 the venue has answered meanwhile and the new status shows.
      onChanged();
      busy.current = false;
      setPending(false);
    }
  };

  const withdraw = () => void act<{ series: SeriesJson }>('withdraw', () => setResult(null));
  const cancelFuture = async () => {
    await act<CancelResult>('cancel-future', (res) => {
      const dates = res.kept
        .map((k) => series.games.find((g) => g.id === k.id))
        .filter((g) => g !== undefined)
        .map((g) => formatDate(g.businessDate, 'UTC', lang));
      setResult({ cancelled: res.cancelled.length, kept: dates });
    });
    setConfirming(false);
  };

  return (
    <section id={`series-${series.id}`} className={styles.card} aria-label={series.venue.name}>
      <div className={styles.top}>
        <span className={styles.venue}>{series.venue.name}</span>
        <SeriesStatusBadge status={series.status} />
      </div>
      <p className={styles.meta}>
        {series.turf.name} · {weekdayList(series.pattern.weekdays, lang)} · <span className={styles.nums}>{time}</span>
      </p>

      {series.status === 'requested' && series.respondBy && (
        <p className={styles.note}>{t('series.player.answerBy', { when: formatDateTime(series.respondBy, tz, lang) })}</p>
      )}
      {series.status === 'declined' && series.declineReason && (
        <p className={styles.meta}>{t('series.player.reason', { reason: series.declineReason })}</p>
      )}
      {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
      {result && result.cancelled > 0 && <Alert tone="success">{t('series.player.cancelled', { count: result.cancelled })}</Alert>}
      {result && result.kept.length > 0 && <Alert tone="warning">{t('series.player.kept', { dates: result.kept.join(', ') })}</Alert>}

      {hasFoot && (
        <div className={styles.foot}>
          <div className={styles.lists}>
            {next.length > 0 && (
              <details className={styles.details}>
                <summary className={styles.summary}>{t('series.player.nextGames', { count: next.length })}</summary>
                <ul className={styles.games}>
                  {next.map((g) => (
                    <li key={g.id}>
                      <Link to={`/me/bookings/${encodeURIComponent(g.id)}`} className={styles.game}>
                        <span className={styles.nums}>
                          {formatDate(g.businessDate, 'UTC', lang)}, {formatTime(g.startAt, tz, lang)}
                        </span>
                        <BookingStatusBadge status={g.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {series.skipped.length > 0 && (
              <details className={styles.details}>
                <summary className={styles.summary}>{t('series.player.skippedDates', { count: series.skipped.length })}</summary>
                <ul className={styles.games}>
                  {series.skipped.map((k) => (
                    <li key={k.date} className={styles.game}>
                      <span>{formatDate(k.date, 'UTC', lang)}</span>
                      <span className={styles.muted}>{t(`series.reason.${k.reason}`)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {canWithdraw && (
            <Button variant="secondary" icon="ban" loading={pending} onClick={withdraw}>
              {t('series.player.withdraw')}
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" icon="ban" disabled={pending} onClick={() => setConfirming(true)}>
              {t('series.player.cancelFuture')}
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirming} onClose={() => !pending && setConfirming(false)} title={t('series.player.cancelFutureTitle', { count: cancellable.length })}>
        <p className={styles.muted}>{t('series.player.cancelFutureBody')}</p>
        <div className={styles.actions}>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            {t('series.player.keep')}
          </Button>
          <Button variant="danger" icon="ban" loading={pending} onClick={() => void cancelFuture()}>
            {t('series.player.cancelFutureConfirm')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
