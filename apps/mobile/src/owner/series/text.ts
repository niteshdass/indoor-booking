import type { TFunction } from 'i18next';
import { localParts, WEEKDAYS, type SeriesJson, type SeriesStatus, type Weekday } from '@booking/shared';
import type { BadgeTone } from '../../ui';
import type { OwnerTurf } from '../types';

/** Same tones as apps/web/src/series/SeriesBadge.tsx. */
export const SERIES_TONE: Record<SeriesStatus, BadgeTone> = {
  requested: 'warning',
  active: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
  cancelled: 'danger',
  ended: 'neutral',
};

/** Player name or group name; falls back to the unknown-customer label. */
export function seriesCustomer(s: SeriesJson, t: TFunction): string {
  return s.player?.name ?? s.guest?.name ?? t('owner.unknownCustomer');
}

/** Short weekday name in the UI language; index 0 is Monday. */
export function weekdayName(lang: string, index: number): string {
  return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index)));
}

/** "Mon, Wed" in week order. */
export function weekdayList(days: Weekday[], lang: string): string {
  return WEEKDAYS.map((d, i) => (days.includes(d) ? weekdayName(lang, i) : null))
    .filter((x): x is string => x !== null)
    .join(', ');
}

export function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "Mon, Wed · 10:00–11:00"; the end is left out when the turf is unknown. */
export function patternSummary(s: SeriesJson, turf: OwnerTurf | undefined, lang: string): string {
  const { weekdays, startTime, slotCount } = s.pattern;
  const end = turf ? `–${addMinutes(startTime, slotCount * turf.slotLengthMin)}` : '';
  return `${weekdayList(weekdays, lang)} · ${startTime}${end}`;
}

/** "Sat, 7 Nov" for a business date (YYYY-MM-DD). */
export function dayLabel(date: string, lang: string, weekday = true): string {
  return new Intl.DateTimeFormat(lang, { ...(weekday ? { weekday: 'short' as const } : {}), day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "Sat, 7 Nov, 18:00" for an instant in the venue's timezone. */
export function dateTimeLabel(iso: string, tz: string, lang: string): string {
  const p = localParts(new Date(iso), tz);
  return `${dayLabel(p.date, lang)}, ${p.hm}`;
}

/** "18:00" in the venue's timezone. */
export const timeLabel = (iso: string, tz: string): string => localParts(new Date(iso), tz).hm;

/** First to last game date, or the pattern's own bounds when no game exists. */
export function dateRange(s: SeriesJson, lang: string): string {
  const dates = s.games.map((g) => g.businessDate).sort();
  const first = dates[0] ?? s.pattern.firstDate;
  const last = dates[dates.length - 1] ?? s.pattern.endDate;
  const f = (d: string) => dayLabel(d, lang, false);
  return last && last !== first ? `${f(first)} – ${f(last)}` : f(first);
}

/** "1 h 30 min" for a number of minutes. */
export function duration(minutes: number, t: TFunction): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('series.durationM', { m });
  return m === 0 ? t('series.durationH', { h }) : t('series.durationHM', { h, m });
}
