import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import type { PublicVenue } from '../lib/types';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DateStrip } from './DateStrip';
import { PhotoStrip } from './PhotoStrip';
import styles from './VenuePage.module.css';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string | null): s is string {
  if (!s || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; venue: PublicVenue }
  | { status: 'not_found' }
  | { status: 'error'; error: unknown };

export function VenuePage() {
  const { slug = '' } = useParams();
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ venue: PublicVenue }>(`/venues/${encodeURIComponent(slug)}`).then(
      (r) => live && setState({ status: 'ready', venue: r.venue }),
      (error: unknown) => {
        if (!live) return;
        setState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error });
      },
    );
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  const update = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) next.set(k, v);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  if (state.status === 'not_found') return <NotFoundPage />;
  if (state.status === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>
          <Spinner label={t('common.loading')} />
        </div>
        <div className={styles.skeleton} aria-hidden="true" />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className={styles.page}>
        <Alert tone="danger" className={styles.alert}>
          <span>{errorMessage(state.error, t)}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t('search.retry')}
          </Button>
        </Alert>
      </main>
    );
  }

  const { venue } = state;
  const today = localParts(new Date(), venue.timezone).date;
  const dateParam = params.get('date');
  const date = validDate(dateParam) ? dateParam : today;
  const turf = venue.turfs.find((x) => x.id === params.get('turf')) ?? venue.turfs[0];
  const sports = [...new Set(venue.turfs.flatMap((x) => x.sports))];

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = venue.turfs.findIndex((x) => x.id === turf?.id);
    const n = venue.turfs.length;
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    const target = venue.turfs[to]!;
    update({ turf: target.id });
    document.getElementById(`turf-tab-${target.id}`)?.focus();
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{venue.name}</h1>
        <p className={styles.address}>
          {venue.address}, {venue.city}
        </p>
        {sports.length > 0 && (
          <ul className={styles.chips}>
            {sports.map((s) => (
              <li key={s}>
                <Badge tone="neutral">{t(`sports.${s}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
        {venue.amenities.length > 0 && (
          <ul className={styles.chips} aria-label={t('venue.amenities')}>
            {venue.amenities.map((a) => (
              <li key={a}>
                <Badge tone="info">{t(`amenities.${a}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </header>

      <PhotoStrip photos={venue.photos} name={venue.name} />

      {turf ? (
        <>
          <div className={styles.tabs} role="tablist" aria-label={t('venue.turfs')} onKeyDown={onTabKey}>
            {venue.turfs.map((x) => {
              const active = x.id === turf.id;
              return (
                <button
                  key={x.id}
                  id={`turf-tab-${x.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="turf-panel"
                  tabIndex={active ? 0 : -1}
                  className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
                  onClick={() => update({ turf: x.id })}
                >
                  <span className={styles.tabName}>{x.name}</span>
                  <span className={styles.tabKind}>{t(x.indoor ? 'venue.indoor' : 'venue.outdoor')}</span>
                </button>
              );
            })}
          </div>

          <DateStrip today={today} value={date} onChange={(d) => update({ date: d })} timeZone={venue.timezone} />

          <section id="turf-panel" role="tabpanel" aria-labelledby={`turf-tab-${turf.id}`} className={styles.slots}>
            <h2 className={styles.slotsTitle}>{t('venue.slotsRegion')}</h2>
            <p className={styles.selected}>
              {t('venue.selected', { turf: turf.name, date: formatDate(date, 'UTC', i18n.language) })}
            </p>
            <p className={styles.soon}>{t('venue.slotsSoon')}</p>
          </section>
        </>
      ) : (
        <p className={styles.empty}>{t('venue.noTurfs')}</p>
      )}
    </main>
  );
}
