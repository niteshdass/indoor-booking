import type { TFunction } from 'i18next';
import type { SeriesJson } from '@booking/shared';
import { formatDate } from '../../lib/format';
import { weekdayList } from '../../series/weekdays';
import type { OwnerTurf } from '../types';

/** Player name or group name; falls back to the unknown-customer label. */
export function seriesCustomer(s: SeriesJson, t: TFunction): string {
  return s.player?.name ?? s.guest?.name ?? t('owner.unknownCustomer');
}

function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "Mon, Wed · 10:00 – 11:00"; the end is left out when the court is unknown. */
export function patternSummary(s: SeriesJson, turf: OwnerTurf | undefined, lang: string): string {
  const { weekdays, startTime, slotCount } = s.pattern;
  const end = turf ? ` – ${addMinutes(startTime, slotCount * turf.slotLengthMin)}` : '';
  return `${weekdayList(weekdays, lang)} · ${startTime}${end}`;
}

/** First to last game date, or the pattern's own bounds when no game exists. */
export function dateRange(s: SeriesJson, lang: string): string {
  const dates = s.games.map((g) => g.businessDate).sort();
  const first = dates[0] ?? s.pattern.firstDate;
  const last = dates[dates.length - 1] ?? s.pattern.endDate;
  const f = (d: string) => formatDate(d, 'UTC', lang);
  return last && last !== first ? `${f(first)} – ${f(last)}` : f(first);
}
