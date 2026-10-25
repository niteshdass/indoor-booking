import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import type { OwnerReviewJson } from '@booking/shared';
import { User } from '../../auth/user.model';
import { Booking } from '../../bookings/booking.model';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { tenantRepo } from '../../tenancy/repo';
import { Venue } from '../../venues/venue.model';
import { scopedVenue } from '../../venues/routes/venues';
import { ownerReviewJson } from '../json';
import { ratingJson } from '../rating';
import { Review, type ReviewDoc } from '../review.model';
import { flagBodySchema, replyBodySchema } from '../schemas';

const OWNER_REVIEW_PAGE_SIZE = 20;

const idQuery = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');
const listQuery = z
  .object({
    venueId: idQuery,
    stars: z.enum(['1', '2', '3', '4', '5']).transform(Number),
    before: idQuery,
    limit: z.string().regex(/^\d+$/, 'Use a whole number').transform(Number).pipe(z.number().int().min(1).max(100)),
  })
  .partial()
  .strict();

const reviews = (t: TenantContext) => tenantRepo(Review, t, { venueField: 'venueId' });

async function scopedReview(t: TenantContext, id: string): Promise<ReviewDoc> {
  const review = await reviews(t).findById(id);
  if (!review) throw new AppError(404, 'not_found', 'Review not found');
  return review;
}

async function jsonFor(rows: ReviewDoc[]): Promise<OwnerReviewJson[]> {
  const [users, bookings] = await Promise.all([
    User.find({ _id: { $in: rows.map((r) => r.playerId) } }).select('name'),
    Booking.find({ _id: { $in: rows.map((r) => r.bookingId) } }).setOptions({ crossTenant: true }).select('reference'),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  const refs = new Map(bookings.map((b) => [String(b._id), b.reference]));
  return rows.map((r) => ownerReviewJson(r, names.get(String(r.playerId)), refs.get(String(r.bookingId)) ?? ''));
}

/** Mounted on ownerRouter. Owners and staff may reply to and flag reviews, never change or remove them. */
export function ownerReviewsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  const guard = requirePermission('review.manage');

  router.get('/reviews', guard, async (req, res) => {
    const t = tenantOf(req);
    const q = listQuery.parse(req.query);
    if (q.venueId) await scopedVenue(t, q.venueId);
    const limit = q.limit ?? OWNER_REVIEW_PAGE_SIZE;
    const filter: Record<string, unknown> = {};
    if (q.venueId) filter.venueId = q.venueId;
    if (q.stars) filter.stars = q.stars;
    if (q.before) filter._id = { $lt: new mongoose.Types.ObjectId(q.before) };
    const [rows, venues] = await Promise.all([
      reviews(t).find(filter).sort({ _id: -1 }).limit(limit + 1),
      tenantRepo(Venue, t, { venueField: '_id' }).find().sort({ name: 1, _id: 1 }),
    ]);
    const page = rows.slice(0, limit);
    res.json({
      reviews: await jsonFor(page),
      nextBefore: rows.length > limit ? String(page[page.length - 1]!._id) : null,
      summary: venues.map((v) => ({ venueId: String(v._id), name: v.name, rating: ratingJson(v.rating) })),
    });
  });

  router.put('/reviews/:reviewId/reply', guard, async (req, res) => {
    const t = tenantOf(req);
    const { text } = replyBodySchema.parse(req.body);
    const review = await scopedReview(t, req.params.reviewId as string);
    if (review.moderation === 'hidden') throw new AppError(409, 'cannot_reply', 'This review cannot be replied to');
    const now = services.now();
    const before = review.reply ? { text: review.reply.text } : null;
    review.reply = review.reply
      ? { text, by: review.reply.by, at: review.reply.at, editedAt: now }
      : { text, by: new mongoose.Types.ObjectId(t.userId), at: now, editedAt: null };
    await review.save();
    await logActivity(
      t,
      { action: 'review.replied', entity: 'review', entityId: review.id as string, venueId: String(review.venueId), before, after: { text } },
      now,
    );
    res.json({ review: (await jsonFor([review]))[0] });
  });

  router.delete('/reviews/:reviewId/reply', guard, async (req, res) => {
    const t = tenantOf(req);
    const review = await scopedReview(t, req.params.reviewId as string);
    if (review.reply) {
      const before = { text: review.reply.text };
      review.reply = null;
      await review.save();
      await logActivity(
        t,
        { action: 'review.reply_deleted', entity: 'review', entityId: review.id as string, venueId: String(review.venueId), before },
        services.now(),
      );
    }
    res.status(204).end();
  });

  router.post('/reviews/:reviewId/flag', guard, async (req, res) => {
    const t = tenantOf(req);
    const { reason } = flagBodySchema.parse(req.body ?? {});
    const review = await scopedReview(t, req.params.reviewId as string);
    if (!review.flag) {
      if (review.flagCleared || review.moderation === 'hidden') {
        throw new AppError(409, 'cannot_flag', 'This review cannot be flagged');
      }
      const now = services.now();
      review.flag = { by: new mongoose.Types.ObjectId(t.userId), at: now, reason: reason ?? null };
      await review.save();
      await logActivity(
        t,
        { action: 'review.flagged', entity: 'review', entityId: review.id as string, venueId: String(review.venueId), after: { reason: reason ?? null } },
        now,
      );
    }
    res.json({ review: (await jsonFor([review]))[0] });
  });

  return router;
}
