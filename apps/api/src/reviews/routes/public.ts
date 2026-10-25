import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { REVIEW_PAGE_SIZE, type PublicReviewJson } from '@booking/shared';
import { User } from '../../auth/user.model';
import { AppError } from '../../errors';
import { publicVenueBySlug } from '../../venues/routes/public';
import { publicReviewJson } from '../json';
import { Review } from '../review.model';

const querySchema = z
  .object({
    before: z.string().refine((v) => mongoose.isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v), 'Use a review id'),
    limit: z
      .string()
      .regex(/^\d+$/, 'Use a whole number')
      .transform(Number)
      .pipe(z.number().int().min(1).max(50)),
  })
  .partial()
  .strict();

/** Unauthenticated, paged list of a published venue's visible reviews. */
export function publicReviewsRouter(): Router {
  const router = Router();

  router.get('/venues/:slug/reviews', async (req, res) => {
    const venue = await publicVenueBySlug(req.params.slug);
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(400, 'validation_error', 'Invalid query', parsed.error.flatten());
    const limit = parsed.data.limit ?? REVIEW_PAGE_SIZE;

    const filter: Record<string, unknown> = { ownerId: venue.ownerId, venueId: venue._id, moderation: 'visible' };
    if (parsed.data.before) filter._id = { $lt: new mongoose.Types.ObjectId(parsed.data.before) };
    const rows = await Review.find(filter)
      .setOptions({ crossTenant: true })
      .sort({ _id: -1 })
      .limit(limit + 1);
    const page = rows.slice(0, limit);

    const users = await User.find({ _id: { $in: page.map((r) => r.playerId) } }).select('name');
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    const reviews: PublicReviewJson[] = page.map((r) => publicReviewJson(r, names.get(String(r.playerId))));
    res.json({ reviews, nextBefore: rows.length > limit ? String(page[page.length - 1]!._id) : null });
  });

  return router;
}
