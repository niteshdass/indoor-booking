import type { ClientSession } from 'mongoose';
import {
  SERIES_REQUEST_HOURS,
  SERIES_REQUEST_LEAD_HOURS,
  SeriesPatternError,
  expandSeriesDates,
  localParts,
  platformFeeFor,
  type ComputedSlot,
  type DaySlots,
  type EffectiveSettings,
  type PlatformFeeSettings,
  type PlatformFeeSnapshot,
  type SeriesClashReason,
  type SeriesDate,
  type SeriesPattern,
  type SeriesPreview,
} from '@booking/shared';
import { resolveGeneral } from '../admin/settings';
import type { Config } from '../config';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { loadDay } from '../schedule/load';
import { lockTurf } from '../venues/guards';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { Booking, holdingFilter, type BookingDoc } from '../bookings/booking.model';
import { REFERENCE_ATTEMPTS, expireStaleHolds, keyHas, lockSlots, overlapping } from '../bookings/create';
import { newReference } from '../bookings/reference';
import { RecurringSeries, type SeriesDoc } from './series.model';

export type SeriesWho = { playerId: string | null; guest: { name: string; phone: string } | null; createdBy: string | null };

type Game = { date: string; slots: ComputedSlot[]; startAt: Date; endAt: Date; price: number };
type Checked = { date: string; game: Game } | { date: string; reason: SeriesClashReason };

const HOUR_MS = 3_600_000;

/** The platform fee in force for an online series; walk-in (owner-made) series carry none. */
async function feeSettings(config: Config, source: 'online' | 'walkin'): Promise<PlatformFeeSettings | null> {
  return source === 'online' ? (await resolveGeneral(config)).fee : null;
}

/** A game's fee snapshot and the total the player owes for it. */
function priced(fee: PlatformFeeSettings | null, g: Game, currency: string): { platformFee: PlatformFeeSnapshot | null; total: number } {
  const platformFee = fee ? platformFeeFor(fee, g.price, currency) : null;
  return { platformFee, total: g.price + (platformFee?.payer === 'player' ? platformFee.amount : 0) };
}

/**
 * The run of `slotCount` back-to-back slots starting at local `startTime`, or why the date clashes.
 * First match wins: closed, past, taken, blocked, outside_hours.
 */
function gameOn(day: DaySlots, pattern: SeriesPattern, now: Date): Game | SeriesClashReason {
  if (day.closed) return 'closed';
  const run: ComputedSlot[] = [];
  const i = day.slots.findIndex((s) => s.localStart === pattern.startTime);
  if (i >= 0) {
    run.push(day.slots[i]!);
    for (let k = i + 1; run.length < pattern.slotCount && k < day.slots.length; k++) {
      const next = day.slots[k]!;
      if (next.startAt.getTime() !== run[run.length - 1]!.endAt.getTime()) break;
      run.push(next);
    }
  }
  // A held slot that has started still reads as past: the date cannot be played any more.
  if (run.some((s) => s.status === 'past' || s.startAt <= now)) return 'past';
  if (run.some((s) => s.status === 'booked' || s.status === 'pending')) return 'taken';
  if (run.some((s) => s.status === 'blocked')) return 'blocked';
  if (run.length < pattern.slotCount || run.some((s) => s.price === null)) return 'outside_hours';
  return {
    date: day.businessDate,
    slots: run,
    startAt: run[0]!.startAt,
    endAt: run[run.length - 1]!.endAt,
    price: run.reduce((sum, s) => sum + s.price!, 0),
  };
}

async function checkDate(venue: VenueDoc, turf: TurfDoc, pattern: SeriesPattern, date: string, now: Date) {
  const { day, settings } = await loadDay(String(venue.ownerId), venue, turf, date, now);
  const res = gameOn(day, pattern, now);
  const checked: Checked = typeof res === 'string' ? { date, reason: res } : { date, game: res };
  return { checked, settings };
}

function datesOf(venue: VenueDoc, pattern: SeriesPattern, now: Date): string[] {
  try {
    return expandSeriesDates(pattern, localParts(now, venue.timezone).date);
  } catch (err) {
    if (err instanceof SeriesPatternError) throw new AppError(400, err.code, 'The series pattern is not allowed');
    throw err;
  }
}

/** Every date of the pattern, checked against the live grid. Ignores bookingWindowDays. */
async function checkAll(venue: VenueDoc, turf: TurfDoc, pattern: SeriesPattern, now: Date) {
  const dates = datesOf(venue, pattern, now);
  const results = await Promise.all(dates.map((d) => checkDate(venue, turf, pattern, d, now)));
  return results.map((r) => r.checked);
}

/**
 * Validates the pattern (maps SeriesPatternError to AppError 400 with its code) and checks every date.
 * `source` is how the series would be booked: online (a player's request) games carry the platform fee.
 */
export async function seriesAvailability(
  venue: VenueDoc,
  turf: TurfDoc,
  pattern: SeriesPattern,
  now: Date,
  opts: { config: Config; source: 'online' | 'walkin' },
): Promise<SeriesPreview> {
  const checked = await checkAll(venue, turf, pattern, now);
  const fee = await feeSettings(opts.config, opts.source);
  const dates: SeriesDate[] = checked.map((c) =>
    'game' in c
      ? { date: c.date, status: 'free', startAt: c.game.startAt.toISOString(), endAt: c.game.endAt.toISOString(), price: c.game.price }
      : { date: c.date, status: 'clash', reason: c.reason },
  );
  const free = checked.flatMap((c) => ('game' in c ? [c.game] : []));
  const games = free.map((g) => priced(fee, g, venue.currency));
  return {
    currency: venue.currency,
    dates,
    freeCount: free.length,
    total: games.reduce((sum, g) => sum + g.total, 0),
    platformFee: fee && fee.mode !== 'free' ? { payer: fee.payer, perGame: games.map((g) => g.platformFee?.amount ?? 0) } : null,
  };
}

/**
 * Re-checks and books in one transaction. Returns the series and its games. Throws 409
 * series_no_free_dates (nothing written) when no date is free. `beforeCommit` runs inside the
 * transaction after the games are written (activity, notices, request checks).
 */
export async function bookSeries(input: {
  venue: VenueDoc;
  turf: TurfDoc;
  pattern: SeriesPattern;
  who: SeriesWho;
  mode: 'owner' | 'request';
  now: Date;
  /** Reads the platform fee in force for request (online) series. */
  config: Config;
  beforeCommit?: (session: ClientSession, series: SeriesDoc, games: BookingDoc[]) => Promise<void>;
}): Promise<{ series: SeriesDoc; games: BookingDoc[] }> {
  const { venue, turf, pattern, who, mode, now, config, beforeCommit } = input;
  const ownerId = String(venue.ownerId);
  const preview = await checkAll(venue, turf, pattern, now);
  const owner = mode === 'owner';
  const fee = await feeSettings(config, owner ? 'walkin' : 'online');

  /** Dates found taken by a slot-lock clash on an earlier attempt. */
  const lost = new Set<string>();
  /** Slot start (ms) → date, for the attempt in flight: maps a duplicate lock back to its date. */
  let lockDates = new Map<number, string>();

  const attempt = () =>
    runInTransaction(async (session) => {
      await lockTurf({ ownerId }, turf.id as string, now, session);

      const skipped: { date: string; reason: SeriesClashReason }[] = [];
      const candidates: string[] = [];
      for (const c of preview) {
        if ('reason' in c) skipped.push({ date: c.date, reason: c.reason });
        else if (lost.has(c.date)) skipped.push({ date: c.date, reason: 'taken' });
        else candidates.push(c.date);
      }

      const games: Game[] = [];
      let settings: EffectiveSettings | null = null;
      for (const date of candidates) {
        const { checked, settings: s } = await checkDate(venue, turf, pattern, date, now);
        settings = s;
        if ('reason' in checked) {
          skipped.push({ date, reason: checked.reason });
          continue;
        }
        const range = { startAt: checked.game.startAt, endAt: checked.game.endAt };
        await expireStaleHolds(ownerId, turf._id, range, now, session);
        const held = await Booking.exists({ ownerId, turfId: turf._id, ...overlapping(range), ...holdingFilter(now) }).session(session);
        if (held) skipped.push({ date, reason: 'taken' });
        else games.push(checked.game);
      }
      if (games.length === 0 || !settings) {
        throw new AppError(409, 'series_no_free_dates', 'None of the series dates is free');
      }
      skipped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const first = games[0]!;
      const last = games[games.length - 1]!;
      const respondBy = owner
        ? null
        : new Date(Math.min(now.getTime() + SERIES_REQUEST_HOURS * HOUR_MS, first.startAt.getTime() - SERIES_REQUEST_LEAD_HOURS * HOUR_MS));
      if (respondBy && respondBy <= now) {
        throw new AppError(409, 'series_too_soon', 'The first game is too soon to wait for an answer');
      }

      const [series] = await RecurringSeries.create(
        [
          {
            ownerId,
            venueId: venue._id,
            turfId: turf._id,
            source: owner ? 'walkin' : 'online',
            playerId: who.playerId,
            guest: who.guest,
            createdBy: who.createdBy,
            weekdays: pattern.weekdays,
            startTime: pattern.startTime,
            slotCount: pattern.slotCount,
            firstDate: pattern.firstDate,
            endDate: pattern.endDate,
            count: pattern.count,
            status: owner ? 'active' : 'requested',
            currency: venue.currency,
            skipped,
            firstStartAt: first.startAt,
            lastEndAt: last.endAt,
            respondBy,
            createdAt: now,
          },
        ],
        { session },
      );

      const docs = await Booking.create(
        games.map((g) => ({
          ownerId,
          venueId: venue._id,
          turfId: turf._id,
          seriesId: series!._id,
          reference: newReference(),
          businessDate: g.date,
          startAt: g.startAt,
          endAt: g.endAt,
          slots: g.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt, price: s.price! })),
          addons: [],
          currency: venue.currency,
          subtotal: g.price,
          addonsTotal: 0,
          ...priced(fee, g, venue.currency),
          // Series take no advance, fee or not.
          advanceRequired: 0,
          amountPaid: 0,
          status: owner ? 'confirmed' : 'pending',
          paymentStatus: 'unpaid',
          holdExpiresAt: null,
          source: owner ? 'walkin' : 'online',
          playerId: who.playerId,
          guest: who.guest,
          policySnapshot: { paymentPolicy: null, refundRules: settings!.refundRules },
          createdBy: who.createdBy,
          // The app clock, not the wall clock: the reminder sweep compares it with startAt.
          createdAt: now,
        })),
        { session, ordered: true },
      );

      lockDates = new Map(games.flatMap((g) => g.slots.map((s) => [s.startAt.getTime(), g.date] as const)));
      for (const [i, g] of games.entries()) await lockSlots(ownerId, turf._id, docs[i]!._id, g.slots, session);

      await beforeCommit?.(session, series!, docs);
      return { series: series!, games: docs };
    });

  // A duplicate key aborts the transaction: a reference clash reruns it with fresh references, a
  // slot lock someone else committed reruns it without that date. Each rerun drops a date, so it ends.
  for (let refTries = 1; ; ) {
    try {
      return await attempt();
    } catch (err) {
      if (keyHas(err, 'reference') && refTries < REFERENCE_ATTEMPTS) {
        refTries++;
        continue;
      }
      if (keyHas(err, 'startAt')) {
        const at = (err as { keyValue?: { startAt?: unknown } }).keyValue?.startAt;
        const date = at === undefined ? undefined : lockDates.get(new Date(at as string | Date).getTime());
        if (date !== undefined && !lost.has(date)) {
          lost.add(date);
          continue;
        }
      }
      throw err;
    }
  }
}
