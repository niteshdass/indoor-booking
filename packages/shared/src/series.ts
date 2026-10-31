import type { FeePayer } from './platformFee';
import type { BookingStatus } from './statuses';
import { addDays, weekdayOf } from './time';
import type { Weekday } from './venues';

export const SERIES_MAX_DAYS = 182;
export const SERIES_MAX_GAMES = 100;
export const SERIES_REQUEST_HOURS = 48;
export const SERIES_REQUEST_LEAD_HOURS = 2;
export const SERIES_MAX_OPEN_REQUESTS = 3;

export const SERIES_STATUSES = ['requested', 'active', 'declined', 'withdrawn', 'cancelled', 'ended'] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

export const SERIES_CLASH_REASONS = ['closed', 'past', 'taken', 'blocked', 'outside_hours'] as const;
export type SeriesClashReason = (typeof SERIES_CLASH_REASONS)[number];

export type SeriesPattern = {
  weekdays: Weekday[];
  startTime: string;
  slotCount: number;
  firstDate: string;
  endDate: string | null;
  count: number | null;
};

export type SeriesDate =
  | { date: string; status: 'free'; startAt: string; endAt: string; price: number }
  | { date: string; status: 'clash'; reason: SeriesClashReason };

/**
 * `total` includes a player-paid fee. `platformFee` is null when no fee applies (walk-in series, free
 * mode); `perGame` is in minor units, one per free date in order (0 where a game's fee rounds to nothing).
 */
export type SeriesPreview = {
  currency: string;
  dates: SeriesDate[];
  freeCount: number;
  total: number;
  platformFee: { payer: FeePayer; perGame: number[] } | null;
};

export type SeriesGameJson = {
  id: string;
  reference: string;
  businessDate: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  total: number;
  amountPaid: number;
};

export type SeriesJson = {
  id: string;
  venueId: string;
  turfId: string;
  status: SeriesStatus;
  source: 'online' | 'walkin';
  pattern: SeriesPattern;
  currency: string;
  player: { id: string; name: string | null } | null;
  guest: { name: string; phone: string } | null;
  skipped: { date: string; reason: SeriesClashReason }[];
  respondBy: string | null;
  declineReason: string | null;
  createdAt: string;
  games: SeriesGameJson[];
};

export class SeriesPatternError extends Error {
  constructor(public code: 'series_too_long' | 'series_too_many_games' | 'series_past_start') {
    super(code);
    this.name = 'SeriesPatternError';
  }
}

/** Business dates matching the pattern, ascending. Throws SeriesPatternError. */
export function expandSeriesDates(p: SeriesPattern, today: string): string[] {
  if (p.firstDate < today) throw new SeriesPatternError('series_past_start');
  const limit = addDays(today, SERIES_MAX_DAYS);
  // Without a match inside a week past the limit the walk can never end legitimately.
  const stop = addDays(limit, 7);
  const days = new Set<Weekday>(p.weekdays);
  const out: string[] = [];
  for (let d = p.firstDate; ; d = addDays(d, 1)) {
    if (p.endDate !== null && d > p.endDate) break;
    if (p.count !== null && out.length >= p.count) break;
    if (d > stop) throw new SeriesPatternError('series_too_long');
    if (!days.has(weekdayOf(d))) continue;
    if (d > limit) throw new SeriesPatternError('series_too_long');
    if (out.length >= SERIES_MAX_GAMES) throw new SeriesPatternError('series_too_many_games');
    out.push(d);
  }
  return out;
}
