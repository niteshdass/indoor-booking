import type { ClientSession } from 'mongoose';
import { SLOT_FREEING_STATUSES } from '@booking/shared';
import type { Config } from '../config';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import { Booking, holdingFilter, type BookingDoc } from '../bookings/booking.model';
import { cancelBooking, seriesRequestOpen, type Canceller } from '../bookings/cancel';
import { noticeBooking } from '../notifications/outbox';
import type { AppServices } from '../services';
import { logActivity, logSystemActivity, type ActivityEntry } from '../tenancy/activityLog.model';
import { RecurringSeries, type SeriesDoc } from './series.model';

/** Logs a series change as the member or player who made it, or as the system for a guest. */
export async function logSeries(by: Canceller, entry: ActivityEntry, at: Date, session: ClientSession) {
  if (by.kind === 'staff') await logActivity(by.t, entry, at, session);
  else if (by.kind === 'player') await logActivity({ ownerId: by.ownerId, userId: by.userId }, entry, at, session);
  else await logSystemActivity(by.ownerId, entry, at, session);
}

/**
 * Cancels every holding game of the series with startAt > now, one cancelBooking each with notify:false,
 * then one series_games_cancelled summary (representative = first cancelled game) listing cancelled and
 * kept dates. Sets status 'cancelled' when no future holding game is left, recomputes lastEndAt, logs series.cancel.
 */
export async function cancelFutureGames(
  series: SeriesDoc,
  by: Canceller,
  reason: string | undefined,
  deps: { config: Config; services: AppServices },
): Promise<{ cancelled: BookingDoc[]; kept: { booking: BookingDoc; code: string }[] }> {
  const ownerId = String(series.ownerId);
  const fresh = await RecurringSeries.findOne({ ownerId, _id: series._id });
  if (!fresh) throw new AppError(404, 'not_found', 'Series not found');
  if (fresh.status === 'requested') throw seriesRequestOpen();

  const now = deps.services.now();
  const future = await Booking.find({ ownerId, seriesId: series._id, startAt: { $gt: now }, ...holdingFilter(now) }).sort({
    startAt: 1,
  });
  const cancelled: BookingDoc[] = [];
  const kept: { booking: BookingDoc; code: string }[] = [];
  /** A non-AppError stops the loop; the games already cancelled are still summed up, then it rethrows. */
  let failure: { err: unknown } | null = null;
  for (const game of future) {
    try {
      const out = await cancelBooking(game, by, { reason, notify: false }, deps);
      cancelled.push(out.booking);
    } catch (err) {
      if (!(err instanceof AppError)) {
        failure = { err };
        break;
      }
      // Cancelled or rejected by someone else meanwhile: not ours, and not still booked either.
      if (err.code === 'invalid_transition') {
        const at = deps.services.now();
        const holding = await Booking.exists({ ownerId, _id: game._id, ...holdingFilter(at) });
        if (!holding) continue;
      }
      kept.push({ booking: game, code: err.code });
    }
  }
  if (cancelled.length > 0) {
    try {
      await summarise(fresh, cancelled, kept, by, reason, deps);
    } catch (err) {
      // The loop's own failure is the one to report; this one is only logged.
      if (!failure) throw err;
      console.error(`[series] summary of ${String(series._id)} failed after a cancel error`, err);
    }
  }
  if (failure) throw failure.err;
  return { cancelled, kept };
}

/** One transaction after the loop: status and lastEndAt, the summary notice and the series.cancel log. */
async function summarise(
  series: SeriesDoc,
  cancelled: BookingDoc[],
  kept: { booking: BookingDoc; code: string }[],
  by: Canceller,
  reason: string | undefined,
  deps: { config: Config; services: AppServices },
) {
  const ownerId = String(series.ownerId);
  await runInTransaction(async (session) => {
    const at = deps.services.now();
    const left = await Booking.exists({ ownerId, seriesId: series._id, startAt: { $gt: at }, ...holdingFilter(at) }).session(session);
    const last = await Booking.findOne({ ownerId, seriesId: series._id, status: { $nin: [...SLOT_FREEING_STATUSES] } })
      .sort({ endAt: -1 })
      .session(session);
    const before = series.status;
    // Only a live series becomes cancelled; conditional on the status read, so a concurrent change wins.
    const status = !left && before === 'active' ? 'cancelled' : before;
    await RecurringSeries.updateOne(
      { ownerId, _id: series._id, status: before },
      { $set: { status, ...(last ? { lastEndAt: last.endAt } : {}) } },
      { session },
    );

    await noticeBooking('series_games_cancelled', cancelled[0]!, at, session, {
      seriesId: String(series._id),
      games: cancelled.map((g) => g.startAt.toISOString()),
      kept: kept.map((k) => k.booking.startAt.toISOString()),
      toStaff: by.kind !== 'staff',
      reason: reason ?? null,
    });
    await logSeries(
      by,
      {
        action: 'series.cancel',
        entity: 'series',
        entityId: String(series._id),
        venueId: String(series.venueId),
        before: { status: before },
        after: {
          status,
          cancelled: cancelled.length,
          kept: kept.length,
          ...(reason ? { reason } : {}),
        },
      },
      at,
      session,
    );
  });
}
