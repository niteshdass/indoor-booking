import { Router } from 'express';
import { z } from 'zod';
import { SERIES_STATUSES, type SeriesClashReason, type SeriesJson } from '@booking/shared';
import { normalizePhone } from '../../auth/normalize';
import { User } from '../../auth/user.model';
import type { Config } from '../../config';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { noticeBooking } from '../../notifications/outbox';
import { scopedTurf } from '../../venues/guards';
import { scopedVenue } from '../../venues/routes/venues';
import { Booking, type BookingDoc } from '../../bookings/booking.model';
import { walkinPlayerId } from '../../bookings/routes/owner';
import { transition } from '../../bookings/transition';
import { bookSeries, seriesAvailability } from '../engine';
import { cancelFutureGames } from '../cancelFuture';
import { declineSeriesGames } from '../decline';
import { ownerSeriesSchema, reasonSchema, seriesPatternSchema } from '../schemas';
import { RecurringSeries, seriesJson, type SeriesDoc } from '../series.model';

/** Series per list page; each carries up to SERIES_MAX_GAMES games. */
export const SERIES_PAGE_SIZE = 50;

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');

const listQuery = z.object({
  venueId: idQuery.optional(),
  status: z.enum(SERIES_STATUSES).optional(),
  before: idQuery.optional(),
});

const seriesNotFound = () => new AppError(404, 'not_found', 'Series not found');
const notRequested = () => new AppError(409, 'series_not_requested', 'This series is no longer waiting for an answer');

/** The series, if it belongs to this tenant and its venue is in the member's scope; else 404. */
async function scopedSeries(t: TenantContext, seriesId: string): Promise<SeriesDoc> {
  const series = await tenantRepo(RecurringSeries, t, { venueField: 'venueId' }).findById(seriesId);
  if (!series) throw seriesNotFound();
  return series;
}

/** Series JSON with each series' games and player name, in two queries for the whole list. */
async function seriesListJson(ownerId: string, list: SeriesDoc[]): Promise<SeriesJson[]> {
  if (list.length === 0) return [];
  const games = await Booking.find({ ownerId, seriesId: { $in: list.map((s) => s._id) } }).sort({ startAt: 1 });
  const players = await User.find({ _id: { $in: list.flatMap((s) => (s.playerId ? [s.playerId] : [])) } }, { name: 1 });
  const nameById = new Map(players.map((u) => [String(u._id), u.name ?? null]));
  const bySeries = new Map<string, BookingDoc[]>();
  for (const g of games) {
    const key = String(g.seriesId);
    bySeries.set(key, [...(bySeries.get(key) ?? []), g]);
  }
  return list.map((s) =>
    seriesJson(s, bySeries.get(String(s._id)) ?? [], s.playerId ? (nameById.get(String(s.playerId)) ?? null) : null),
  );
}

const oneJson = async (ownerId: string, s: SeriesDoc) => (await seriesListJson(ownerId, [s]))[0]!;

/** Mounted on ownerRouter. */
export function ownerSeriesRouter(config: Config, services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.post('/venues/:venueId/turfs/:turfId/series/preview', requirePermission('booking.create'), async (req, res) => {
    const t = tenantOf(req);
    const pattern = seriesPatternSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    res.json({ preview: await seriesAvailability(venue, turf, pattern, services.now()) });
  });

  router.post('/venues/:venueId/turfs/:turfId/series', requirePermission('booking.create'), async (req, res) => {
    const t = tenantOf(req);
    const { pattern, customer } = ownerSeriesSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const phone = normalizePhone(customer.phone);
    const playerId = await walkinPlayerId(customer.playerId);
    const now = services.now();
    const out = await bookSeries({
      venue,
      turf,
      pattern,
      who: { playerId, guest: { name: customer.name, phone }, createdBy: t.userId },
      mode: 'owner',
      now,
      // Same transaction as the inserts: the series, its log and its notice commit or fail together.
      beforeCommit: async (session, series, games) => {
        const skipped = series.skipped.map((k) => ({ date: k.date, reason: k.reason as SeriesClashReason }));
        await logActivity(
          t,
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
        await noticeBooking('series_created', games[0]!, now, session, {
          seriesId: series.id as string,
          games: games.map((g) => g.startAt.toISOString()),
          skipped,
        });
      },
    });
    res.status(201).json({ series: seriesJson(out.series, out.games, playerId ? await playerName(playerId) : null) });
  });

  router.get('/series', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const q = listQuery.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (q.venueId) {
      await scopedVenue(t, q.venueId);
      filter.venueId = q.venueId;
    }
    if (q.status) filter.status = q.status;
    if (q.before) filter._id = { $lt: q.before };
    const rows = await tenantRepo(RecurringSeries, t, { venueField: 'venueId' })
      .find(filter)
      .sort({ _id: -1 })
      .limit(SERIES_PAGE_SIZE + 1);
    const page = rows.slice(0, SERIES_PAGE_SIZE);
    res.json({
      series: await seriesListJson(t.ownerId, page),
      nextBefore: rows.length > SERIES_PAGE_SIZE ? String(page[page.length - 1]!._id) : null,
    });
  });

  router.get('/series/:seriesId', requirePermission('booking.view'), async (req, res) => {
    const t = tenantOf(req);
    const series = await scopedSeries(t, req.params.seriesId as string);
    res.json({ series: await oneJson(t.ownerId, series) });
  });

  /**
   * Answers a request: one conditional update moves the series out of `requested`, so of two
   * answers (or an answer and the auto-decline sweep) only one matches; the loser's transaction
   * conflicts, retries, matches nothing and gets 409. Every pending game follows in the same transaction.
   */
  async function answer(t: TenantContext, seriesId: string, accept: boolean, reason: string | null) {
    const series = await scopedSeries(t, seriesId);
    return runInTransaction(async (session) => {
      const now = services.now();
      // A lapsed request can only be declined: accepting it could confirm games already under way.
      const moved = await RecurringSeries.findOneAndUpdate(
        { ownerId: t.ownerId, _id: series._id, status: 'requested', ...(accept ? { respondBy: { $gt: now } } : {}) },
        {
          $set: {
            status: accept ? 'active' : 'declined',
            decidedAt: now,
            decidedBy: t.userId,
            ...(accept ? {} : { declineReason: reason }),
          },
        },
        { session, new: true },
      );
      if (!moved) throw notRequested();
      let games: BookingDoc[];
      if (accept) {
        const pending = await Booking.find({ ownerId: t.ownerId, seriesId: series._id, status: 'pending' })
          .sort({ startAt: 1 })
          .session(session);
        games = [];
        // One act on the whole series: the series row below is its only activity record.
        for (const g of pending) games.push(await transition(t, g, 'confirmed', now, session, {}, {}, { log: false }));
      } else {
        games = await declineSeriesGames(series, t, { rejectReason: reason, noticeReason: reason }, now, session);
      }
      await logActivity(
        t,
        {
          action: accept ? 'series.accept' : 'series.decline',
          entity: 'series',
          entityId: series.id as string,
          venueId: String(series.venueId),
          before: { status: 'requested' },
          after: { status: moved.status, games: games.length, ...(reason ? { reason } : {}) },
        },
        now,
        session,
      );
      if (accept && games.length > 0) {
        await noticeBooking('series_accepted', games[0]!, now, session, {
          seriesId: series.id as string,
          games: games.map((g) => g.startAt.toISOString()),
        });
      }
      return moved;
    });
  }

  router.post('/series/:seriesId/accept', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const series = await answer(t, req.params.seriesId as string, true, null);
    res.json({ series: await oneJson(t.ownerId, series) });
  });

  router.post('/series/:seriesId/decline', requirePermission('booking.confirm'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = reasonSchema.parse(req.body ?? {});
    const series = await answer(t, req.params.seriesId as string, false, reason || null);
    res.json({ series: await oneJson(t.ownerId, series) });
  });

  router.post('/series/:seriesId/cancel-future', requirePermission('booking.cancel'), async (req, res) => {
    const t = tenantOf(req);
    const { reason } = reasonSchema.parse(req.body ?? {});
    const series = await scopedSeries(t, req.params.seriesId as string);
    const out = await cancelFutureGames(series, { kind: 'staff', t }, reason || undefined, { config, services });
    const fresh = (await RecurringSeries.findOne({ ownerId: t.ownerId, _id: series._id }))!;
    res.json({
      series: await oneJson(t.ownerId, fresh),
      cancelled: out.cancelled.map((b) => String(b._id)),
      kept: out.kept.map((k) => ({ id: String(k.booking._id), code: k.code })),
    });
  });

  return router;
}

async function playerName(id: string): Promise<string | null> {
  const user = await User.findById(id, { name: 1 });
  return user?.name ?? null;
}
