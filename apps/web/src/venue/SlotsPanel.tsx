import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { addDays, MAX_BOOKINGS_PER_GROUP } from '@booking/shared';
import { useAuth } from '../auth/useAuth';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate, money } from '../lib/format';
import type { SlotDay, SlotJson } from '../lib/types';
import { checkoutHref } from '../checkout/checkoutParams';
import { RepeatDays } from './RepeatDays';
import { SlotGrid } from './SlotGrid';
import { isSelectable, runsOf } from './slotSelection';
import styles from './SlotsPanel.module.css';

/** How many days after the shown one are offered as copy chips. */
const AHEAD = 7;

type State = { status: 'loading' } | { status: 'ready' } | { status: 'error'; error: unknown };

/** Picked slot starts per date, each list ascending. */
export type Picks = Record<string, string[]>;

type Props = {
  slug: string;
  turfId: string;
  turfName: string;
  date: string;
  tabId: string;
  /** Opens another day, keeping the picks. */
  onDate(date: string): void;
  /** Reports how many slots are picked on each day. */
  onPicked?(counts: Record<string, number>): void;
};

const storeKey = (slug: string, turfId: string) => `picks:${slug}:${turfId}`;

function loadPicks(key: string): Picks {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Picks = {};
    for (const [d, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(list) && list.length > 0) out[d] = list.filter((x): x is string => typeof x === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

/** Every picked run on every day, in time order; days not loaded yet are left out. */
function bookingsOf(picks: Picks, cache: Record<string, SlotDay>): { date: string; slots: SlotJson[] }[] {
  return Object.keys(picks)
    .sort()
    .flatMap((d) => (cache[d] ? runsOf(cache[d].slots, picks[d]!).map((slots) => ({ date: d, slots })) : []));
}

const sum = (slots: SlotJson[]) => slots.reduce((n, s) => n + (s.price ?? 0), 0);
const range = (run: SlotJson[]) => `${run[0]!.localStart}–${run[run.length - 1]!.localEnd}`;

/**
 * Slots of one turf plus the pick: any free slots on any days, each consecutive run one booking, all in
 * one checkout. Mount it with a key of the turf; the pick survives a change of `date` and a reload.
 */
export function SlotsPanel({ slug, turfId, turfName, date, tabId, onDate, onPicked }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { status: auth } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [cache, setCache] = useState<Record<string, SlotDay>>({});
  const key = storeKey(slug, turfId);
  const [picks, setPicks] = useState<Picks>(() => loadPicks(key));
  const [capped, setCapped] = useState(false);

  const base = `/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/slots?date=`;

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ day: SlotDay }>(base + date).then(
      (r) => {
        if (!live) return;
        setCache((c) => ({ ...c, [date]: r.day }));
        setState({ status: 'ready' });
      },
      (error: unknown) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [base, date, attempt]);

  // Days with picks (for prices) and, while this day has a pick, the days after it (for the copy chips).
  const pickedHere = (picks[date]?.length ?? 0) > 0;
  const ahead = Array.from({ length: AHEAD }, (_, i) => addDays(date, i + 1));
  const wantedKey = [...new Set([...Object.keys(picks), ...(pickedHere ? ahead : [])])]
    .filter((d) => d !== date && !cache[d])
    .sort()
    .join(',');
  useEffect(() => {
    if (!wantedKey) return;
    let live = true;
    Promise.all(wantedKey.split(',').map((d) => apiGet<{ day: SlotDay }>(base + d).then((r) => r.day, () => null))).then((list) => {
      if (!live) return;
      setCache((c) => {
        const next = { ...c };
        for (const d of list) if (d) next[d.businessDate] = d;
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [wantedKey, base]);

  // Fresh slots: drop picks that are no longer free.
  useEffect(() => {
    setPicks((p) => {
      let changed = false;
      const next: Picks = {};
      for (const [d, list] of Object.entries(p)) {
        const day = cache[d];
        const kept = day ? list.filter((x) => day.slots.some((s) => s.startAt === x && isSelectable(s))) : list;
        if (kept.length !== list.length) changed = true;
        if (kept.length > 0) next[d] = kept;
      }
      return changed ? next : p;
    });
  }, [cache]);

  useEffect(() => {
    try {
      if (Object.keys(picks).length > 0) sessionStorage.setItem(key, JSON.stringify(picks));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage off: the pick lives only on this page.
    }
    onPicked?.(Object.fromEntries(Object.entries(picks).map(([d, list]) => [d, list.length])));
  }, [picks, key, onPicked]);

  const day = state.status === 'ready' ? cache[date] ?? null : null;
  const selected = picks[date] ?? [];

  /** Sets one day's picks, unless that would make more bookings than one checkout takes. */
  const setDay = useCallback(
    (d: string, list: string[]) => {
      const next = { ...picks };
      if (list.length > 0) next[d] = [...list].sort();
      else delete next[d];
      if (bookingsOf(next, cache).length > MAX_BOOKINGS_PER_GROUP) {
        setCapped(true);
        return false;
      }
      setCapped(false);
      setPicks(next);
      return true;
    },
    [picks, cache],
  );

  const onToggle = useCallback(
    (startAt: string) => {
      if (!day) return;
      const slot = day.slots.find((s) => s.startAt === startAt);
      if (!slot) return;
      if (selected.includes(startAt)) setDay(date, selected.filter((x) => x !== startAt));
      else if (isSelectable(slot)) setDay(date, [...selected, startAt]);
    },
    [day, selected, date, setDay],
  );

  const localStarts = day ? day.slots.filter((s) => selected.includes(s.startAt)).map((s) => s.localStart) : [];
  /** Copies this day's times onto `d`, or clears `d` when it already has them. */
  const copyTo = (d: string) => {
    const target = cache[d];
    if (!target) return;
    const same = target.slots.filter((s) => localStarts.includes(s.localStart));
    const on = (picks[d] ?? []).length === same.length && same.every((s) => picks[d]!.includes(s.startAt));
    setDay(d, on ? [] : same.map((s) => s.startAt));
  };

  const bookings = bookingsOf(picks, cache);
  const pickedDays = Object.keys(picks).sort();
  const slotCount = pickedDays.reduce((n, d) => n + picks[d]!.length, 0);
  const total = bookings.reduce((n, b) => n + sum(b.slots), 0);
  const currency = day?.currency ?? Object.values(cache)[0]?.currency ?? '';
  const [first, ...more] = bookings;
  const ready = first !== undefined && bookings.reduce((n, b) => n + b.slots.length, 0) === slotCount;
  const href = first
    ? checkoutHref(
        slug,
        turfId,
        first.date,
        first.slots.map((s) => s.startAt),
        more.map((b) => ({ date: b.date, startAts: b.slots.map((s) => s.startAt) })),
      )
    : '';

  const aheadDays = ahead.map((d) => cache[d]).filter((d): d is SlotDay => d !== undefined && d.status !== 'outside_window');
  const copied = aheadDays.filter((d) => {
    const list = picks[d.businessDate] ?? [];
    const same = d.slots.filter((s) => localStarts.includes(s.localStart));
    return same.length === localStarts.length && list.length === same.length && same.every((s) => list.includes(s.startAt));
  });

  const messageOnly =
    state.status === 'loading' || (day !== null && (day.status !== 'open' || day.slots.length === 0));

  const shortDate = (d: string) => formatDate(d, 'UTC', lang);
  const rangesOn = (d: string) => (cache[d] ? runsOf(cache[d].slots, picks[d] ?? []).map(range).join(', ') : '');
  const multi = pickedDays.length > 1;
  const countText = multi
    ? t('slots.slotsOnDays', {
        slots: t('slots.selectedCount', { count: slotCount }),
        days: t('slots.dayCount', { count: pickedDays.length }),
      })
    : t('slots.selectedCount', { count: slotCount });

  return (
    <div
      id="turf-panel"
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={messageOnly ? 0 : undefined}
      className={styles.panel}
    >
      <div className={styles.main}>
        {state.status === 'loading' && <Skeleton kind="list" label={t('common.loading')} />}
        {state.status === 'error' && (
          <Alert tone="danger" className={styles.alert}>
            <span>{errorMessage(state.error, t)}</span>
            <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              {t('search.retry')}
            </Button>
          </Alert>
        )}
        {day && <SlotGrid day={day} selected={selected} onToggle={onToggle} />}
        {capped && <Alert tone="warning">{t('slots.full', { count: MAX_BOOKINGS_PER_GROUP })}</Alert>}
        {day && pickedHere && (
          <RepeatDays
            days={aheadDays}
            localStarts={localStarts}
            value={copied.map((d) => d.businessDate)}
            full={bookings.length + runsOf(day.slots, selected).length > MAX_BOOKINGS_PER_GROUP}
            onToggle={copyTo}
          />
        )}
        {auth === 'signedIn' && (
          <p className={styles.weekly}>
            {t('venue.weeklyPrompt')}{' '}
            <Link
              className={styles.weeklyLink}
              to={`/venues/${encodeURIComponent(slug)}/series?turfId=${encodeURIComponent(turfId)}&date=${date}`}
            >
              {t('series.player.requestLink')}
            </Link>
          </p>
        )}
      </div>

      <p className={styles.live} aria-live="polite">
        {slotCount > 0 ? countText : ''}
      </p>
      {(day || slotCount > 0) && (
        <aside className={[styles.bar, slotCount > 0 ? '' : styles.barEmpty].filter(Boolean).join(' ')} aria-label={t('slots.summary')}>
          <h3 className={styles.barTitle}>{t('slots.summary')}</h3>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>{t('venue.court')}</dt>
              <dd>{turfName}</dd>
            </div>
            <div className={[styles.fact, multi ? styles.factStack : ''].filter(Boolean).join(' ')}>
              <dt>{multi ? t('venue.days') : t('venue.date')}</dt>
              <dd>
                {multi ? (
                  <ul className={styles.dayList}>
                    {pickedDays.map((d) => (
                      <li key={d} className={styles.dayItem}>
                        <button
                          type="button"
                          className={[styles.dayLink, d === date ? styles.dayHere : ''].filter(Boolean).join(' ')}
                          aria-current={d === date ? 'true' : undefined}
                          aria-label={t('slots.showDay', { date: shortDate(d) })}
                          onClick={() => onDate(d)}
                        >
                          {shortDate(d)}
                        </button>
                        <span className={styles.dayTimes}>{rangesOn(d)}</span>
                        <button
                          type="button"
                          className={styles.dayRemove}
                          aria-label={t('slots.clearDay', { date: shortDate(d) })}
                          onClick={() => setDay(d, [])}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  shortDate(pickedDays[0] ?? date)
                )}
              </dd>
            </div>
            {slotCount > 0 && (
              <div className={styles.fact}>
                <dt>{t('venue.time')}</dt>
                <dd>
                  {!multi && (
                    <>
                      <span className={styles.range}>{rangesOn(pickedDays[0]!)}</span>{' '}
                    </>
                  )}
                  <span className={multi ? styles.range : styles.count}>{countText}</span>
                </dd>
              </div>
            )}
          </dl>
          {slotCount > 0 ? (
            <>
              <p className={styles.totalRow}>
                <span className={styles.totalLabel}>{t('venue.total')}</span>
                <span className={styles.total}>{currency ? money(total, currency, lang) : null}</span>
              </p>
              <Button
                to={ready ? href : undefined}
                disabled={!ready}
                variant="brand"
                size="lg"
                block
                className={styles.cta}
              >
                {t('slots.continue')}
              </Button>
            </>
          ) : (
            <p className={styles.hint}>{t('slots.pickHint')}</p>
          )}
        </aside>
      )}
    </div>
  );
}
