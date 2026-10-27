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
/** Picks per court of the venue. */
export type CourtPicks = Record<string, Picks>;

type Court = { id: string; name: string };

type Props = {
  slug: string;
  /** Every court of the venue, in tab order. */
  turfs: Court[];
  /** The shown court. */
  turfId: string;
  date: string;
  tabId: string;
  /** Opens another day, on this or another court, keeping the picks. */
  onOpen(turfId: string, date: string): void;
  /** Reports how many slots are picked on each day of each court. */
  onPicked?(counts: Record<string, Record<string, number>>): void;
};

const storeKey = (slug: string) => `picks:${slug}`;
/** Where picks lived when they were kept per court. */
const legacyKey = (slug: string, turfId: string) => `picks:${slug}:${turfId}`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readPicks(raw: unknown): Picks {
  if (!raw || typeof raw !== 'object') return {};
  const out: Picks = {};
  for (const [d, list] of Object.entries(raw as Record<string, unknown>)) {
    if (ISO_DATE.test(d) && Array.isArray(list) && list.length > 0) out[d] = list.filter((x): x is string => typeof x === 'string');
  }
  return out;
}

function loadPicks(slug: string, turfs: Court[]): CourtPicks {
  try {
    const raw = sessionStorage.getItem(storeKey(slug));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: CourtPicks = {};
    for (const { id } of turfs) {
      const legacy = sessionStorage.getItem(legacyKey(slug, id));
      sessionStorage.removeItem(legacyKey(slug, id));
      const picks = readPicks(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[id] : legacy ? JSON.parse(legacy) : null);
      if (Object.keys(picks).length > 0) out[id] = picks;
    }
    return out;
  } catch {
    return {};
  }
}

/** Cache key of one day of one court. */
const cell = (turfId: string, date: string) => `${turfId}|${date}`;

type Run = { turfId: string; date: string; slots: SlotJson[] };

/** Every picked run on every court and day, courts in tab order, then by time; days not loaded yet are left out. */
function bookingsOf(turfs: Court[], picks: CourtPicks, cache: Record<string, SlotDay>): Run[] {
  return turfs.flatMap(({ id }) => {
    const mine = picks[id] ?? {};
    return Object.keys(mine)
      .sort()
      .flatMap((d) => {
        const day = cache[cell(id, d)];
        return day ? runsOf(day.slots, mine[d]!).map((slots) => ({ turfId: id, date: d, slots })) : [];
      });
  });
}

const sum = (slots: SlotJson[]) => slots.reduce((n, s) => n + (s.price ?? 0), 0);
const range = (run: SlotJson[]) => `${run[0]!.localStart}–${run[run.length - 1]!.localEnd}`;

/**
 * Slots of the shown court plus the pick: any free slots on any courts and days, each consecutive run one
 * booking, all in one checkout. The pick survives a change of court or `date` and a reload.
 */
export function SlotsPanel({ slug, turfs, turfId, date, tabId, onOpen, onPicked }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { status: auth } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [cache, setCache] = useState<Record<string, SlotDay>>({});
  const key = storeKey(slug);
  const [all, setAll] = useState<CourtPicks>(() => loadPicks(slug, turfs));
  const [capped, setCapped] = useState(false);
  const picks = all[turfId] ?? {};

  const slotsUrl = useCallback(
    (court: string, d: string) => `/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(court)}/slots?date=${d}`,
    [slug],
  );

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ day: SlotDay }>(slotsUrl(turfId, date)).then(
      (r) => {
        if (!live) return;
        setCache((c) => ({ ...c, [cell(turfId, date)]: r.day }));
        setState({ status: 'ready' });
      },
      (error: unknown) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [slotsUrl, turfId, date, attempt]);

  // Days with picks on any court (for prices) and, while this day has a pick, the days after it (for the copy chips).
  const pickedHere = (picks[date]?.length ?? 0) > 0;
  const ahead = Array.from({ length: AHEAD }, (_, i) => addDays(date, i + 1));
  const wantedKey = [
    ...new Set([
      ...Object.entries(all).flatMap(([id, p]) => Object.keys(p).map((d) => cell(id, d))),
      ...(pickedHere ? ahead.map((d) => cell(turfId, d)) : []),
    ]),
  ]
    .filter((c) => c !== cell(turfId, date) && !cache[c])
    .sort()
    .join(',');
  useEffect(() => {
    if (!wantedKey) return;
    let live = true;
    const cells = wantedKey.split(',');
    Promise.all(
      cells.map((c) => {
        const [id, d] = c.split('|') as [string, string];
        return apiGet<{ day: SlotDay }>(slotsUrl(id, d)).then((r) => r.day, () => null);
      }),
    ).then((list) => {
      if (!live) return;
      setCache((c) => {
        const next = { ...c };
        list.forEach((d, i) => {
          if (d) next[cells[i]!] = d;
        });
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [wantedKey, slotsUrl]);

  // Fresh slots: drop picks that are no longer free.
  useEffect(() => {
    setAll((p) => {
      let changed = false;
      const next: CourtPicks = {};
      for (const [id, days] of Object.entries(p)) {
        const kept: Picks = {};
        for (const [d, list] of Object.entries(days)) {
          const day = cache[cell(id, d)];
          const left = day ? list.filter((x) => day.slots.some((s) => s.startAt === x && isSelectable(s))) : list;
          if (left.length !== list.length) changed = true;
          if (left.length > 0) kept[d] = left;
        }
        if (Object.keys(kept).length > 0) next[id] = kept;
      }
      return changed ? next : p;
    });
  }, [cache]);

  useEffect(() => {
    try {
      if (Object.keys(all).length > 0) sessionStorage.setItem(key, JSON.stringify(all));
      else sessionStorage.removeItem(key);
    } catch {
      // Storage off: the pick lives only on this page.
    }
    onPicked?.(
      Object.fromEntries(Object.entries(all).map(([id, days]) => [id, Object.fromEntries(Object.entries(days).map(([d, list]) => [d, list.length]))])),
    );
  }, [all, key, onPicked]);

  const day = state.status === 'ready' ? cache[cell(turfId, date)] ?? null : null;
  const selected = picks[date] ?? [];

  /** Sets one day's picks on one court, unless that would make more bookings than one checkout takes. */
  const setDay = useCallback(
    (court: string, d: string, list: string[]) => {
      const days = { ...(all[court] ?? {}) };
      if (list.length > 0) days[d] = [...list].sort();
      else delete days[d];
      const next = { ...all };
      if (Object.keys(days).length > 0) next[court] = days;
      else delete next[court];
      if (bookingsOf(turfs, next, cache).length > MAX_BOOKINGS_PER_GROUP) {
        setCapped(true);
        return false;
      }
      setCapped(false);
      setAll(next);
      return true;
    },
    [all, turfs, cache],
  );

  const onToggle = useCallback(
    (startAt: string) => {
      if (!day) return;
      const slot = day.slots.find((s) => s.startAt === startAt);
      if (!slot) return;
      if (selected.includes(startAt)) setDay(turfId, date, selected.filter((x) => x !== startAt));
      else if (isSelectable(slot)) setDay(turfId, date, [...selected, startAt]);
    },
    [day, selected, turfId, date, setDay],
  );

  const localStarts = day ? day.slots.filter((s) => selected.includes(s.startAt)).map((s) => s.localStart) : [];
  /** Copies this day's times onto `d`, or clears `d` when it already has them. */
  const copyTo = (d: string) => {
    const target = cache[cell(turfId, d)];
    if (!target) return;
    const same = target.slots.filter((s) => localStarts.includes(s.localStart));
    const on = (picks[d] ?? []).length === same.length && same.every((s) => picks[d]!.includes(s.startAt));
    setDay(turfId, d, on ? [] : same.map((s) => s.startAt));
  };

  const bookings = bookingsOf(turfs, all, cache);
  /** Every court and day with picks, courts in tab order. */
  const picked = turfs.flatMap(({ id, name }) =>
    Object.keys(all[id] ?? {})
      .sort()
      .map((d) => ({ turfId: id, name, date: d, count: all[id]![d]!.length })),
  );
  const courts = turfs.filter((x) => all[x.id]);
  const slotCount = picked.reduce((n, p) => n + p.count, 0);
  const dayCount = new Set(picked.map((p) => p.date)).size;
  const total = bookings.reduce((n, b) => n + sum(b.slots), 0);
  const currency = day?.currency ?? Object.values(cache)[0]?.currency ?? '';
  const [first, ...more] = bookings;
  const ready = first !== undefined && bookings.reduce((n, b) => n + b.slots.length, 0) === slotCount;
  const href = first
    ? checkoutHref(
        slug,
        first.turfId,
        first.date,
        first.slots.map((s) => s.startAt),
        more.map((b) => ({ turfId: b.turfId, date: b.date, startAts: b.slots.map((s) => s.startAt) })),
      )
    : '';

  const aheadDays = ahead
    .map((d) => cache[cell(turfId, d)])
    .filter((d): d is SlotDay => d !== undefined && d.status !== 'outside_window');
  const copied = aheadDays.filter((d) => {
    const list = picks[d.businessDate] ?? [];
    const same = d.slots.filter((s) => localStarts.includes(s.localStart));
    return same.length === localStarts.length && list.length === same.length && same.every((s) => list.includes(s.startAt));
  });

  const messageOnly =
    state.status === 'loading' || (day !== null && (day.status !== 'open' || day.slots.length === 0));

  const shortDate = (d: string) => formatDate(d, 'UTC', lang);
  const rangesOn = (court: string, d: string) => {
    const cached = cache[cell(court, d)];
    return cached ? runsOf(cached.slots, all[court]?.[d] ?? []).map(range).join(', ') : '';
  };
  const multi = picked.length > 1;
  const multiCourt = courts.length > 1;
  const slotsText = t('slots.selectedCount', { count: slotCount });
  const daysText = t('slots.dayCount', { count: dayCount });
  const countText = multiCourt
    ? t('slots.slotsOnCourts', { slots: slotsText, courts: t('venue.courtCount', { count: courts.length }), days: daysText })
    : multi
      ? t('slots.slotsOnDays', { slots: slotsText, days: daysText })
      : slotsText;
  const courtName = (courts[0] ?? turfs.find((x) => x.id === turfId))?.name ?? '';
  /** One picked court and day: opens it, shows its times, clears it. */
  const pickedItem = (p: (typeof picked)[number]) => {
    const here = p.turfId === turfId && p.date === date;
    const label = multiCourt ? `${p.name}, ${shortDate(p.date)}` : shortDate(p.date);
    return (
      <li key={cell(p.turfId, p.date)} className={styles.dayItem}>
        <button
          type="button"
          className={[styles.dayLink, here ? styles.dayHere : ''].filter(Boolean).join(' ')}
          aria-current={here ? 'true' : undefined}
          aria-label={t('slots.showDay', { date: label })}
          onClick={() => onOpen(p.turfId, p.date)}
        >
          {shortDate(p.date)}
        </button>
        <span className={styles.dayTimes}>{rangesOn(p.turfId, p.date)}</span>
        <button
          type="button"
          className={styles.dayRemove}
          aria-label={t('slots.clearDay', { date: label })}
          onClick={() => setDay(p.turfId, p.date, [])}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </li>
    );
  };

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
              <dt>{multiCourt ? t('venue.courts') : t('venue.court')}</dt>
              <dd>{multiCourt ? t('venue.courtCount', { count: courts.length }) : courtName}</dd>
            </div>
            <div className={[styles.fact, multi ? styles.factStack : ''].filter(Boolean).join(' ')}>
              <dt>{multi ? t('venue.days') : t('venue.date')}</dt>
              <dd>
                {multiCourt ? (
                  <ul className={styles.courtList}>
                    {courts.map((c) => (
                      <li key={c.id} className={styles.courtGroup}>
                        <span className={styles.courtName}>{c.name}</span>
                        <ul className={styles.dayList}>{picked.filter((p) => p.turfId === c.id).map(pickedItem)}</ul>
                      </li>
                    ))}
                  </ul>
                ) : multi ? (
                  <ul className={styles.dayList}>{picked.map(pickedItem)}</ul>
                ) : (
                  shortDate(picked[0]?.date ?? date)
                )}
              </dd>
            </div>
            {slotCount > 0 && (
              <div className={styles.fact}>
                <dt>{t('venue.time')}</dt>
                <dd>
                  {!multi && (
                    <>
                      <span className={styles.range}>{rangesOn(picked[0]!.turfId, picked[0]!.date)}</span>{' '}
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
