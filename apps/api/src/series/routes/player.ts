import { Router } from 'express';
import mongoose from 'mongoose';
import {
  SERIES_MAX_OPEN_REQUESTS,
  type SeriesClashReason,
  type SeriesJson,
} from '@booking/shared';
import { requireAuth } from '../../auth/requireAuth';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { noticeBooking } from '../../notifications/outbox';
import { Venue } from '../../venues/venue.model';
import { Turf } from '../../venues/turf.model';
import { publicTurf } from '../../venues/routes/public';
import { Booking, type BookingDoc } from '../../bookings/booking.model';
import { transition } from '../../bookings/transition';
import { bookSeries, seriesAvailability } from '../engine';
import { cancelFutureGames } from '../cancelFuture';
import { reasonSchema, seriesPatternSchema } from '../schemas';
import { RecurringSeries, seriesJson, type SeriesDoc } from '../series.model';

/** Series per page of "my series". */
const MY_SERIES_LIMIT = 50;

const cross = { crossTenant: true };
const seriesNotFound = () => new AppError(404, 'not_found', 'Series not found');
const limitReached = () =>
  new AppError(409, 'series_request_limit', `You can have at most ${SERIES_MAX_OPEN_REQUESTS} requests waiting for an answer`);

const openRequests = (playerId: string, session?: mongoose.ClientSession) =>
  RecurringSeries.countDocuments({ playerId, status: 'requested' }).setOptions(cross).session(session ?? null);

/** The player's own series, else 404 (never 403, so ids don't leak). */
async function mySeries(seriesId: string, userId: string): Promise<SeriesDoc> {
  const series = mongoose.isValidObjectId(seriesId)
    ? await RecurringSeries.findOne({ _id: seriesId, playerId: userId }).setOptions(cross)
    : null;
  if (!series) throw seriesNotFound();
  return series;
}

/** Players never see a group's contact: guest is always null on this side. */
const playerJson = (s: SeriesDoc, games: BookingDoc[], name: string | null): SeriesJson => ({
  ...seriesJson(s, games, name),
  guest: null,
});

async function oneJson(s: SeriesDoc, name: string | null): Promise<SeriesJson> {
  const games = await Booking.find({ ownerId: s.ownerId, seriesId: s._id }).sort({ startAt: 1 });
  return playerJson(s, games, name);
}

export function playerSeriesRouter(config: Config, services: AppServices): Router {
  const router = Router();
  const auth = requireAuth(config, services);

  router.post('/venues/:slug/turfs/:turfId/series/preview', auth, async (req, res) => {
    const pattern = seriesPatternSchema.parse(req.body);
    const { venue, turf } = await publicTurf(req.params.slug as string, req.params.turfId as string);
    res.json({ preview: await seriesAvailability(venue, turf, pattern, services.now()) });
  });

  router.post('/venues/:slug/turfs/:turfId/series', auth, async (req, res) => {
    const userId = req.auth!.userId;
    const pattern = seriesPatternSchema.parse(req.body);
    const { venue, turf } = await publicTurf(req.params.slug as string, req.params.turfId as string);
    if ((await openRequests(userId)) >= SERIES_MAX_OPEN_REQUESTS) throw limitReached();
    const now = services.now();
    const out = await bookSeries({
      venue,
      turf,
      pattern,
      who: { playerId: userId, guest: null, createdBy: userId },
      mode: 'request',
      now,
      beforeCommit: async (session, series, games) => {
        // The new series counts too, so more than the cap means a parallel request got there first.
        if ((await openRequests(userId, session)) > SERIES_MAX_OPEN_REQUESTS) throw limitReached();
        const skipped = series.skipped.map((k) => ({ date: k.date, reason: k.reason as SeriesClashReason }));
        await logActivity(
          { ownerId: String(venue.ownerId), userId },
          {
            action: 'series.create',
            entity: 'series',
            entityId: series.id as string,
            venueId: String(series.venueId),
            after: { status: series.status, games: games.length, skipped: skipped.length },
          },
          now,
          session,
        );
        await noticeBooking('series_requested', games[0]!, now, session, {
          seriesId: series.id as string,
          games: games.map((g) => g.startAt.toISOString()),
          skipped,
        });
      },
    });
    res.status(201).json({ series: playerJson(out.series, out.games, null) });
  });

  router.get('/me/series', auth, async (req, res) => {
    const userId = req.auth!.userId;
    const list = await RecurringSeries.find({ playerId: userId })
      .setOptions(cross)
      .sort({ _id: -1 })
      .limit(MY_SERIES_LIMIT);
    if (list.length === 0) {
      res.json({ series: [] });
      return;
    }
    const [games, venues, turfs] = await Promise.all([
      Booking.find({ seriesId: { $in: list.map((s) => s._id) } }).setOptions(cross).sort({ startAt: 1 }),
      Venue.find({ _id: { $in: list.map((s) => s.venueId) } }, { slug: 1, name: 1, timezone: 1 }).setOptions(cross),
      Turf.find({ _id: { $in: list.map((s) => s.turfId) } }, { name: 1 }).setOptions(cross),
    ]);
    const venueById = new Map(venues.map((v) => [String(v._id), v]));
    const turfById = new Map(turfs.map((t) => [String(t._id), t]));
    res.json({
      series: list.map((s) => {
        const v = venueById.get(String(s.venueId));
        return {
          ...playerJson(s, games.filter((g) => String(g.seriesId) === String(s._id)), null),
          venue: { slug: v?.slug ?? '', name: v?.name ?? '', timezone: v?.timezone ?? '' },
          turf: { name: turfById.get(String(s.turfId))?.name ?? '' },
        };
      }),
    });
  });

  router.post('/me/series/:seriesId/withdraw', auth, async (req, res) => {
    const userId = req.auth!.userId;
    const series = await mySeries(req.params.seriesId as string, userId);
    const ownerId = String(series.ownerId);
    const actor = { ownerId, userId };
    const moved = await runInTransaction(async (session) => {
      const now = services.now();
      const done = await RecurringSeries.findOneAndUpdate(
        { ownerId, _id: series._id, playerId: userId, status: 'requested' },
        { $set: { status: 'withdrawn', decidedAt: now, decidedBy: userId } },
        { session, new: true },
      );
      if (!done) throw new AppError(409, 'series_not_requested', 'This series is no longer waiting for an answer');
      const pending = await Booking.find({ ownerId, seriesId: series._id, status: 'pending' }).sort({ startAt: 1 }).session(session);
      // One act on the whole series: the series row below is its only activity record.
      for (const g of pending) await transition(actor, g, 'rejected', now, session, {}, {}, { log: false });
      await logActivity(
        actor,
        {
          action: 'series.withdraw',
          entity: 'series',
          entityId: series.id as string,
          venueId: String(series.venueId),
          before: { status: 'requested' },
          after: { status: 'withdrawn', games: pending.length },
        },
        now,
        session,
      );
      return done;
    });
    res.json({ series: await oneJson(moved, null) });
  });

  router.post('/me/series/:seriesId/cancel-future', auth, async (req, res) => {
    const userId = req.auth!.userId;
    const { reason } = reasonSchema.parse(req.body ?? {});
    const series = await mySeries(req.params.seriesId as string, userId);
    const ownerId = String(series.ownerId);
    const out = await cancelFutureGames(series, { kind: 'player', ownerId, userId }, reason || undefined, { config, services });
    const fresh = (await RecurringSeries.findOne({ ownerId, _id: series._id }))!;
    res.json({
      series: await oneJson(fresh, null),
      cancelled: out.cancelled.map((b) => String(b._id)),
      kept: out.kept.map((k) => ({ id: String(k.booking._id), code: k.code })),
    });
  });

  return router;
}
