import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ADMIN_REVIEW_PAGE_SIZE, ADMIN_REVIEW_STATES, type AdminReviewJson, type AdminReviewsJson } from '@booking/shared';
import { User } from '../../auth/user.model';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { recomputeVenueRating } from '../../reviews/rating';
import { Review, type ReviewDoc } from '../../reviews/review.model';
import type { AppServices } from '../../services';
import { Owner } from '../../tenancy/owner.model';
import { Venue } from '../../venues/venue.model';
import { platformOf, requirePlatform } from '../context';
import { logPlatform } from '../platformLog.model';

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');
const listQuery = z.object({ state: z.enum(ADMIN_REVIEW_STATES), before: idQuery }).partial().strict();

/** Review filter for each queue: open flags, hidden by an admin, kept by an admin. */
const STATE_FILTERS: Record<(typeof ADMIN_REVIEW_STATES)[number], Record<string, unknown>> = {
  flagged: { flag: { $ne: null }, moderation: 'visible' },
  hidden: { moderation: 'hidden' },
  kept: { flagCleared: true },
};

function stateOf(r: ReviewDoc): AdminReviewJson['state'] {
  if (r.moderation === 'hidden') return 'hidden';
  if (r.flag) return 'flagged';
  if (r.flagCleared) return 'kept';
  return 'visible';
}

async function jsonFor(rows: ReviewDoc[]): Promise<AdminReviewJson[]> {
  const userIds = rows.flatMap((r) => [r.playerId, ...(r.flag ? [r.flag.by] : [])]);
  const [users, venues, owners] = await Promise.all([
    User.find({ _id: { $in: userIds } }, { name: 1 }).lean(),
    Venue.find({ _id: { $in: rows.map((r) => r.venueId) } }, { name: 1, slug: 1 })
      .setOptions({ crossTenant: true })
      .lean(),
    Owner.find({ _id: { $in: rows.map((r) => r.ownerId) } }, { name: 1 }).lean(),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.name || null]));
  const venueById = new Map(venues.map((v) => [String(v._id), v]));
  const ownerName = new Map(owners.map((o) => [String(o._id), o.name]));
  return rows.map((r) => {
    const venue = venueById.get(String(r.venueId));
    return {
      id: String(r._id),
      stars: r.stars,
      comment: r.comment ?? null,
      createdAt: r.createdAt.toISOString(),
      author: names.get(String(r.playerId)) ?? null,
      venue: { id: String(r.venueId), name: venue?.name ?? '', slug: venue?.slug ?? '' },
      owner: { id: String(r.ownerId), name: ownerName.get(String(r.ownerId)) ?? '' },
      flag: r.flag
        ? { at: r.flag.at.toISOString(), reason: r.flag.reason ?? null, by: names.get(String(r.flag.by)) ?? null }
        : null,
      reply: r.reply ? { text: r.reply.text, at: r.reply.at.toISOString() } : null,
      state: stateOf(r),
    };
  });
}

/** Cross-owner review moderation (the reviews spec's Plan 18 hide/keep); mounted on the admin router. */
export function adminReviewsRouter(services: AppServices): Router {
  const router = Router();
  router.use('/reviews', requirePlatform('platform.reviews'));

  router.get('/reviews', async (req, res) => {
    const q = listQuery.parse(req.query);
    const filter: Record<string, unknown> = { ...STATE_FILTERS[q.state ?? 'flagged'] };
    if (q.before) filter._id = { $lt: new mongoose.Types.ObjectId(q.before) };
    // Cross-owner by design: the platform queue spans every owner.
    const rows = await Review.find(filter)
      .sort({ _id: -1 })
      .limit(ADMIN_REVIEW_PAGE_SIZE + 1)
      .setOptions({ crossTenant: true });
    const page = rows.slice(0, ADMIN_REVIEW_PAGE_SIZE);
    const body: AdminReviewsJson = {
      reviews: await jsonFor(page),
      nextBefore: rows.length > ADMIN_REVIEW_PAGE_SIZE ? String(page[page.length - 1]!._id) : null,
    };
    res.json(body);
  });

  /** Hide or keep a flagged, visible review; both are final. */
  const settle = (path: 'hide' | 'keep') =>
    router.post(`/reviews/:id/${path}`, async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) throw new AppError(404, 'not_found', 'Review not found');
      const actorId = platformOf(req).userId;
      const now = services.now();
      const review = await runInTransaction(async (session) => {
        const found = await Review.findById(id).setOptions({ crossTenant: true }).session(session);
        if (!found) throw new AppError(404, 'not_found', 'Review not found');
        if (!found.flag || found.moderation !== 'visible') {
          throw new AppError(409, 'not_flagged', 'Only a flagged review can be hidden or kept');
        }
        const ownerId = String(found.ownerId);
        const update =
          path === 'hide' ? { $set: { moderation: 'hidden' } } : { $set: { flag: null, flagCleared: true } };
        // Conditional on still being flagged and visible, so two admins cannot both settle it.
        const updated = await Review.findOneAndUpdate({ _id: found._id, ownerId, flag: { $ne: null }, moderation: 'visible' }, update, {
          new: true,
          session,
        });
        if (!updated) throw new AppError(409, 'not_flagged', 'Only a flagged review can be hidden or kept');
        if (path === 'hide') await recomputeVenueRating(ownerId, String(found.venueId), session);
        await logPlatform(
          actorId,
          { action: path === 'hide' ? 'review.hidden' : 'review.kept', entity: 'review', entityId: id, ownerId },
          now,
          session,
        );
        return updated;
      });
      const [json] = await jsonFor([review]);
      res.json({ review: json });
    });

  settle('hide');
  settle('keep');

  return router;
}
