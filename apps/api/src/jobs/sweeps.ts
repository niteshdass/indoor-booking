import { REVIEW_WINDOW_DAYS } from '@booking/shared';
import type { ClientSession, FilterQuery } from 'mongoose';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { Payment } from '../bookings/payment.model';
import { transition, type Actor } from '../bookings/transition';
import { logSystemActivity } from '../tenancy/activityLog.model';
import { noticeBooking } from '../notifications/outbox';
import { declineSeriesGames } from '../series/decline';
import { RecurringSeries, type SeriesDoc } from '../series/series.model';
import { ownerSettings } from '../venues/effective';
import { lockTurf } from '../venues/guards';

export const SWEEP_BATCH = 200;
/** Page size of every sweep; tests lower it. */
export const sweepConfig = { batch: SWEEP_BATCH };
export const REMINDER_LEAD_MINUTES = 120;
export const HOLD_WARNING_MINUTES = 10;
export const REVIEW_REQUEST_DELAY_MINUTES = 180;
/** How long after a game ends staff can still mark it a no-show before it auto-completes. */
export const AUTO_COMPLETE_GRACE_HOURS = 12;
/** Matches REVIEW_WINDOW_DAYS: no point asking once the review window has closed. */
const REVIEW_REQUEST_MAX_DAYS = REVIEW_WINDOW_DAYS;
/** Stored on the booking for staff; the customer's notice is worded by its template, per locale. */
const AUTO_REJECT_REASON = 'Not confirmed in time';
/** pendingAutoRejectHours is at most 72, so nothing starting later can be due. */
const AUTO_REJECT_MAX_HOURS = 72;

const cross = { crossTenant: true };
const MIN = 60_000;
const HOUR = 60 * MIN;

const system = (b: BookingDoc): Actor => ({ ownerId: String(b.ownerId), userId: null });

type Row = { _id: unknown };
/** Reads one page: the rows matching the filter, in `sort` order, at most `limit`. */
type PageReader<T> = (filter: FilterQuery<T>, sort: Record<string, 1>, limit: number) => PromiseLike<T[]>;

/**
 * Runs `step` for each row in its own transaction and counts those it reports as done. A row whose
 * status moved on since it was selected (a 409 from transition) is skipped quietly; any other throw
 * is logged and the sweep goes on.
 */
async function eachRow<T extends Row>(
  name: string,
  rows: T[],
  step: (row: T, session: ClientSession) => Promise<boolean>,
): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      if (await runInTransaction((session) => step(row, session))) done += 1;
    } catch (err) {
      if (err instanceof AppError && err.code === 'invalid_transition') continue;
      console.error(`[jobs] ${name} of ${String(row._id)} failed`, err);
    }
  }
  return done;
}

/**
 * Walks every row of `model` matching `filter` in pages of `sweepConfig.batch`, keyset-paginated on
 * (`key`, _id), so rows a sweep selects but leaves alone never hold back the ones behind them.
 * `pick` narrows each page to the rows to act on; `step` runs per row as in eachRow.
 */
async function sweepModel<T extends Row, K extends string>(
  read: PageReader<T>,
  name: string,
  filter: FilterQuery<T>,
  key: K,
  step: (row: T, session: ClientSession) => Promise<boolean>,
  pick: (page: T[]) => Promise<T[]> | T[] = (page) => page,
): Promise<number> {
  const batch = sweepConfig.batch;
  let done = 0;
  let after: T | undefined;
  for (;;) {
    const keyOf = (r: T) => (r as Record<string, unknown>)[key];
    const past = after ? { $or: [{ [key]: { $gt: keyOf(after) } }, { [key]: keyOf(after), _id: { $gt: after._id } }] } : {};
    const page: T[] = await read({ $and: [filter, past] }, { [key]: 1, _id: 1 }, batch);
    done += await eachRow(name, await pick(page), step);
    if (page.length < batch) return done;
    after = page[page.length - 1];
  }
}

type SortKey = 'holdExpiresAt' | 'startAt' | 'endAt' | 'completedAt';

const sweep = (
  name: string,
  filter: FilterQuery<BookingDoc>,
  key: SortKey,
  step: (b: BookingDoc, session: ClientSession) => Promise<boolean>,
  pick?: (page: BookingDoc[]) => Promise<BookingDoc[]> | BookingDoc[],
) => sweepModel<BookingDoc, SortKey>(
    (f, sort, limit) => Booking.find(f).setOptions(cross).sort(sort).limit(limit),
    name, filter, key, step, pick);

/** Expires lapsed payment holds and frees their slots. The payment and its intent stay for the late-payment path. */
export async function expireHolds(now: Date): Promise<number> {
  return sweep('expireHolds', { status: 'awaiting_payment', holdExpiresAt: { $lte: now } }, 'holdExpiresAt', async (b, session) => {
    const t = system(b);
    await lockTurf(t, String(b.turfId), now, session);
    const fresh = await Booking.findOne({ ownerId: t.ownerId, _id: b._id }).session(session);
    if (fresh?.status !== 'awaiting_payment' || !fresh.holdExpiresAt || fresh.holdExpiresAt > now) return false;
    await transition(t, fresh, 'expired', now, session);
    return true;
  });
}

/**
 * Rejects pending bookings the venue did not confirm by the owner's pendingAutoRejectHours before start.
 * Only those that have not started yet are told. One with a wallet payment waiting to be checked is
 * left for staff: rejecting it would drop money the player already sent.
 */
export async function autoRejectPending(now: Date): Promise<number> {
  const hoursOf = new Map<string, number>();
  const due = async (page: BookingDoc[]) => {
    const manual = await Payment.find({ bookingId: { $in: page.map((b) => b._id) }, kind: 'manual', status: 'pending' })
      .setOptions(cross)
      .select('bookingId');
    const submitted = new Set(manual.map((p) => String(p.bookingId)));
    const out: BookingDoc[] = [];
    for (const b of page) {
      if (submitted.has(String(b._id))) continue;
      const ownerId = String(b.ownerId);
      if (!hoursOf.has(ownerId)) hoursOf.set(ownerId, (await ownerSettings(ownerId)).pendingAutoRejectHours);
      if (b.startAt.getTime() - hoursOf.get(ownerId)! * HOUR <= now.getTime()) out.push(b);
    }
    return out;
  };
  return sweep(
    'autoRejectPending',
    { status: 'pending', seriesId: null, startAt: { $lte: new Date(now.getTime() + AUTO_REJECT_MAX_HOURS * HOUR) } },
    'startAt',
    async (b, session) => {
      const moved = await transition(system(b), b, 'rejected', now, session, { rejectReason: AUTO_REJECT_REASON });
      // A game that already started (a backlog on first deploy, or 0 hours plus job delay) gets no message.
      if (b.startAt > now) await noticeBooking('booking_rejected', moved, now, session, { autoRejected: true });
      return true;
    },
    due,
  );
}

/** Completes confirmed bookings AUTO_COMPLETE_GRACE_HOURS after they end; until then staff can mark a no-show. */
export async function autoCompleteBookings(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_COMPLETE_GRACE_HOURS * 3_600_000);
  return sweep('autoCompleteBookings', { status: 'confirmed', endAt: { $lte: cutoff } }, 'endAt', async (b, session) => {
    await transition(system(b), b, 'completed', now, session);
    return true;
  });
}

/**
 * Enqueues a reminder for confirmed bookings starting within REMINDER_LEAD_MINUTES, except those
 * made inside that window. The notice's dedupe key makes a repeat run a no-op.
 */
export async function sendReminders(now: Date): Promise<number> {
  const lead = REMINDER_LEAD_MINUTES * MIN;
  return sweep(
    'sendReminders',
    {
      status: 'confirmed',
      startAt: { $gt: now, $lte: new Date(now.getTime() + lead) },
      $expr: { $lte: ['$createdAt', { $subtract: ['$startAt', lead] }] },
    },
    'startAt',
    async (b, session) => (await noticeBooking('booking_reminder', b, now, session)) > 0,
  );
}

/** Warns the customer of a payment-link hold that lapses within HOLD_WARNING_MINUTES. */
export async function warnExpiringHolds(now: Date): Promise<number> {
  const withLink = async (page: BookingDoc[]) => {
    const links = await Payment.find({
      bookingId: { $in: page.map((b) => b._id) },
      method: 'card',
      status: 'pending',
      kind: 'link',
    })
      .setOptions(cross)
      .select('bookingId');
    const linked = new Set(links.map((p) => String(p.bookingId)));
    return page.filter((b) => linked.has(String(b._id)));
  };
  return sweep(
    'warnExpiringHolds',
    { status: 'awaiting_payment', holdExpiresAt: { $gt: now, $lte: new Date(now.getTime() + HOLD_WARNING_MINUTES * MIN) } },
    'holdExpiresAt',
    async (b, session) => (await noticeBooking('hold_expiring', b, now, session)) > 0,
    withLink,
  );
}

/**
 * Asks players to review a game some time after it completed. Marks the booking first, so a player
 * with no verified contact is not revisited; returns true only when a notice was queued.
 */
export async function sendReviewRequests(now: Date): Promise<number> {
  return sweep(
    'sendReviewRequests',
    {
      status: 'completed',
      playerId: { $ne: null },
      reviewedAt: null,
      reviewRequestedAt: null,
      completedAt: {
        $lte: new Date(now.getTime() - REVIEW_REQUEST_DELAY_MINUTES * MIN),
        $gt: new Date(now.getTime() - REVIEW_REQUEST_MAX_DAYS * 24 * HOUR),
      },
    },
    'completedAt',
    async (b, session) => {
      const marked = await Booking.updateOne(
        { ownerId: b.ownerId, _id: b._id, reviewRequestedAt: null },
        { $set: { reviewRequestedAt: now } },
        { session },
      );
      if (marked.modifiedCount === 0) return false;
      return (await noticeBooking('review_request', b, now, session)) > 0;
    },
  );
}

type SeriesSortKey = 'respondBy' | 'lastEndAt';

const sweepSeries = (
  name: string,
  filter: FilterQuery<SeriesDoc>,
  key: SeriesSortKey,
  step: (s: SeriesDoc, session: ClientSession) => Promise<boolean>,
) => sweepModel<SeriesDoc, SeriesSortKey>(
    (f, sort, limit) => RecurringSeries.find(f).setOptions(cross).sort(sort).limit(limit),
    name, filter, key, step);

/**
 * Declines series requests nobody answered by respondBy, with their pending games. The conditional
 * update on status 'requested' is the same gate the staff answer and the player's withdraw use, so
 * whichever moves the series first wins and the other matches nothing.
 */
export async function autoDeclineSeries(now: Date): Promise<number> {
  return sweepSeries('autoDeclineSeries', { status: 'requested', respondBy: { $lte: now } }, 'respondBy', async (s, session) => {
    const ownerId = String(s.ownerId);
    const moved = await RecurringSeries.findOneAndUpdate(
      { ownerId: s.ownerId, _id: s._id, status: 'requested', respondBy: { $lte: now } },
      { $set: { status: 'declined', decidedAt: now, declineReason: null } },
      { session, new: true },
    ).setOptions(cross);
    if (!moved) return false;
    const games = await declineSeriesGames(
      s,
      { ownerId, userId: null },
      { rejectReason: AUTO_REJECT_REASON, noticeReason: null, auto: true },
      now,
      session,
    );
    await logSystemActivity(
      ownerId,
      {
        action: 'series.decline',
        entity: 'series',
        entityId: String(s._id),
        venueId: String(s.venueId),
        before: { status: 'requested' },
        after: { status: 'declined', games: games.length, auto: true },
      },
      now,
      session,
    );
    return true;
  });
}

/** Moves active series whose last game has finished to ended. Cancelled, declined and withdrawn ones are never touched. */
export async function endSeries(now: Date): Promise<number> {
  return sweepSeries('endSeries', { status: 'active', lastEndAt: { $lte: now } }, 'lastEndAt', async (s, session) => {
    const moved = await RecurringSeries.updateOne(
      { ownerId: s.ownerId, _id: s._id, status: 'active', lastEndAt: { $lte: now } },
      { $set: { status: 'ended' } },
      { session },
    ).setOptions(cross);
    return moved.modifiedCount > 0;
  });
}
