import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { BookingJson } from '../lib/types';
import { nextGames } from '../series/nextGames';
import type { PlayerSeries } from '../series/types';
import { BookingRow } from './BookingRow';
import { MySeries } from './MySeries';
import styles from './MyBookingsPage.module.css';

const UPCOMING_STATUSES = new Set(['awaiting_payment', 'pending', 'confirmed']);
const TABS = ['upcoming', 'past'] as const;
type Tab = (typeof TABS)[number];

const startMs = (b: BookingJson) => Math.min(...b.slots.map((s) => Date.parse(s.startAt)));
const endMs = (b: BookingJson) => Math.max(...b.slots.map((s) => Date.parse(s.endAt)));

type State = { status: 'loading' } | { status: 'ready'; bookings: BookingJson[]; series: PlayerSeries[] } | { status: 'error'; error: unknown };

export function MyBookingsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('upcoming');

  // The series list is a bonus: if it fails the bookings still show, series games included.
  const fetchAll = useCallback(
    () =>
      Promise.all([
        apiGet<{ bookings: BookingJson[] }>('/me/bookings'),
        apiGet<{ series: PlayerSeries[] }>('/me/series').catch(() => ({ series: [] as PlayerSeries[] })),
      ]),
    [],
  );

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetchAll().then(
      ([b, s]) => live && setState({ status: 'ready', bookings: b.bookings, series: s.series }),
      (error) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [attempt, fetchAll]);

  // After a series action: refetch in place, keeping what is on screen (no spinner, cards keep their state).
  const refresh = useCallback(() => {
    fetchAll().then(
      ([b, s]) => setState({ status: 'ready', bookings: b.bookings, series: s.series }),
      // A failed reload must not leave the stale card's actions usable: show the page error with retry instead.
      (error) => setState({ status: 'error', error }),
    );
  }, [fetchAll]);

  const { upcoming, past } = useMemo(() => {
    const up: BookingJson[] = [];
    const ps: BookingJson[] = [];
    if (state.status === 'ready') {
      const now = Date.now();
      // Only the games a series card lists under "Next games" leave the single list; past, cancelled and rejected ones stay.
      const onCard = new Set(state.series.flatMap((s) => nextGames(s.games, now).map((g) => g.id)));
      for (const b of state.bookings) {
        if (onCard.has(b.id)) continue;
        const isUp = b.slots.length > 0 && UPCOMING_STATUSES.has(b.status) && endMs(b) > now;
        (isUp ? up : ps).push(b);
      }
    }
    up.sort((a, b) => startMs(a) - startMs(b));
    ps.sort((a, b) => (b.slots.length ? startMs(b) : 0) - (a.slots.length ? startMs(a) : 0));
    return { upcoming: up, past: ps };
  }, [state]);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = TABS.length - 1;
    if (to < 0) return;
    e.preventDefault();
    const target = TABS[to]!;
    setTab(target);
    document.getElementById(`bookings-tab-${target}`)?.focus();
  };

  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('myBookings.title')}</h1>
      {state.status === 'ready' && <MySeries series={state.series} onChanged={refresh} />}
      <div className={styles.tabs} role="tablist" aria-label={t('myBookings.title')} onKeyDown={onTabKey}>
        {TABS.map((k) => {
          const active = k === tab;
          return (
            <button
              key={k}
              id={`bookings-tab-${k}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="bookings-panel"
              tabIndex={active ? 0 : -1}
              className={[styles.tab, active ? styles.tabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab(k)}
            >
              {t(`myBookings.${k}`)}
            </button>
          );
        })}
      </div>
      <div id="bookings-panel" role="tabpanel" aria-labelledby={`bookings-tab-${tab}`}>
        {state.status === 'loading' && (
          <div className={styles.loading}>
            <Spinner label={t('common.loading')} />
          </div>
        )}
        {state.status === 'error' && (
          <Alert tone="danger" className={styles.alert}>
            <span>{errorMessage(state.error, t)}</span>
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              {t('search.retry')}
            </Button>
          </Alert>
        )}
        {state.status === 'ready' &&
          (list.length === 0 ? (
            <p className={styles.empty}>
              {tab === 'upcoming' ? (
                <>
                  <span>{t('myBookings.noUpcoming')}</span>
                  <Button to="/search" variant="brand">
                    {t('myBookings.findVenues')}
                  </Button>
                </>
              ) : (
                t('myBookings.noPast')
              )}
            </p>
          ) : (
            <ul className={styles.list}>
              {list.map((b) => (
                <li key={b.id}>
                  <BookingRow booking={b} />
                </li>
              ))}
            </ul>
          ))}
      </div>
    </main>
  );
}
