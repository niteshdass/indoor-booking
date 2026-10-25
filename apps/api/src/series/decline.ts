import type { ClientSession } from 'mongoose';
import type { SeriesClashReason } from '@booking/shared';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { transition, type Actor } from '../bookings/transition';
import { noticeBooking } from '../notifications/outbox';
import type { SeriesDoc } from './series.model';

/**
 * Rejects a declined series' pending games and queues the one series_declined notice, with the booked
 * and skipped dates. The caller has already moved the series out of `requested` in the same
 * transaction and writes the series' activity row (the games log nothing of their own).
 */
export async function declineSeriesGames(
  series: SeriesDoc,
  actor: Actor,
  opts: { rejectReason: string | null; noticeReason: string | null; auto?: boolean },
  now: Date,
  session: ClientSession,
): Promise<BookingDoc[]> {
  const pending = await Booking.find({ ownerId: series.ownerId, seriesId: series._id, status: 'pending' })
    .sort({ startAt: 1 })
    .session(session);
  const games: BookingDoc[] = [];
  for (const g of pending) {
    games.push(await transition(actor, g, 'rejected', now, session, { rejectReason: opts.rejectReason }, {}, { log: false }));
  }
  if (games.length > 0) {
    await noticeBooking('series_declined', games[0]!, now, session, {
      seriesId: String(series._id),
      games: games.map((g) => g.startAt.toISOString()),
      skipped: series.skipped.map((k) => ({ date: k.date, reason: k.reason as SeriesClashReason })),
      reason: opts.noticeReason,
      ...(opts.auto ? { autoRejected: true } : {}),
    });
  }
  return games;
}
