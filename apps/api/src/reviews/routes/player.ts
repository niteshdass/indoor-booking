import { Router } from 'express';
import mongoose from 'mongoose';
import { REVIEW_WINDOW_DAYS } from '@booking/shared';
import { requireAuth } from '../../auth/requireAuth';
import { User } from '../../auth/user.model';
import { Booking } from '../../bookings/booking.model';
import type { Config } from '../../config';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import { AppError } from '../../errors';
import { noticeBooking } from '../../notifications/outbox';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { isEditable, ownReviewJson } from '../json';
import { recomputeVenueRating } from '../rating';
import { Review, type ReviewDoc } from '../review.model';
import { reviewBodySchema, reviewPatchSchema } from '../schemas';

const DAY_MS = 86_400_000;
const cross = { crossTenant: true };

const notFound = () => new AppError(404, 'not_found', 'Booking not found');
const reviewNotFound = () => new AppError(404, 'not_found', 'Review not found');
const notReviewable = () => new AppError(409, 'not_reviewable', 'This booking cannot be reviewed');
const alreadyReviewed = () => new AppError(409, 'already_reviewed', 'This booking has already been reviewed');
const reviewLocked = () => new AppError(409, 'review_locked', 'This review can no longer be changed');

/** A write conflict that outlived withTransaction's retries (another writer kept the document busy). */
const isWriteConflict = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; hasErrorLabel?: (l: string) => boolean };
  return e.code === 112 || e.hasErrorLabel?.('TransientTransactionError') === true;
};

const authorName = async (userId: string) => (await User.findById(userId).select('name'))?.name;

/** The signed-in player's review endpoints for their own bookings. */
export function playerReviewsRouter(config: Config, services: AppServices): Router {
  const router = Router();
  const auth = requireAuth(config, services);

  /** The player's own review of a booking, inside `session`, else 404. */
  async function ownReview(bookingId: string, userId: string, session: mongoose.ClientSession): Promise<ReviewDoc> {
    const review = mongoose.isValidObjectId(bookingId)
      ? await Review.findOne({ bookingId, playerId: userId }).setOptions(cross).session(session)
      : null;
    if (!review) throw reviewNotFound();
    return review;
  }

  router.post('/me/bookings/:bookingId/review', auth, async (req, res) => {
    const input = reviewBodySchema.parse(req.body);
    const userId = req.auth!.userId;
    const bookingId = req.params.bookingId as string;
    if (!mongoose.isValidObjectId(bookingId)) throw notFound();
    const now = services.now();
    const comment = input.comment ?? null;

    let review: ReviewDoc;
    try {
      review = await runInTransaction(async (session) => {
        const booking = await Booking.findOne({ _id: bookingId, playerId: userId }).setOptions(cross).session(session);
        if (!booking) throw notFound();
        const closesAt = booking.completedAt ? booking.completedAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS : null;
        if (booking.status !== 'completed' || closesAt === null || now.getTime() > closesAt) throw notReviewable();

        const ownerId = String(booking.ownerId);
        const claimed = await Booking.findOneAndUpdate(
          { ownerId, _id: booking._id, reviewedAt: null },
          { $set: { reviewedAt: now } },
          { new: true, session },
        );
        if (!claimed) throw alreadyReviewed();

        const venueId = String(booking.venueId);
        const [created] = await Review.create(
          [{ ownerId, venueId, bookingId: booking._id, playerId: userId, stars: input.stars, comment, createdAt: now, updatedAt: now }],
          { session },
        );
        await recomputeVenueRating(ownerId, venueId, session);
        await noticeBooking('review_posted', claimed, now, session, { stars: input.stars, comment });
        await logActivity(
          { ownerId, userId },
          { action: 'review.posted', entity: 'review', entityId: String(created!._id), venueId, after: { stars: input.stars, comment } },
          now,
          session,
        );
        return created!;
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw alreadyReviewed();
      // Lost a race that withTransaction could not settle: 409 only if the booking really is reviewed.
      if (isWriteConflict(err)) {
        const reviewed = await Booking.exists({ _id: bookingId, playerId: userId, reviewedAt: { $ne: null } }).setOptions(cross);
        if (reviewed) throw alreadyReviewed();
      }
      throw err;
    }
    res.status(201).json({ review: ownReviewJson(review, await authorName(userId), now) });
  });

  router.patch('/me/bookings/:bookingId/review', auth, async (req, res) => {
    const input = reviewPatchSchema.parse(req.body);
    const userId = req.auth!.userId;
    const now = services.now();
    const review = await runInTransaction(async (session) => {
      const r = await ownReview(req.params.bookingId as string, userId, session);
      if (!isEditable(r, now)) throw reviewLocked();
      if (input.stars !== undefined) r.stars = input.stars;
      if (input.comment !== undefined) r.comment = input.comment;
      r.editedAt = now;
      await r.save({ session });
      await recomputeVenueRating(String(r.ownerId), String(r.venueId), session);
      return r;
    });
    res.json({ review: ownReviewJson(review, await authorName(userId), now) });
  });

  router.delete('/me/bookings/:bookingId/review', auth, async (req, res) => {
    const userId = req.auth!.userId;
    const now = services.now();
    await runInTransaction(async (session) => {
      const r = await ownReview(req.params.bookingId as string, userId, session);
      if (!isEditable(r, now)) throw reviewLocked();
      // Booking.reviewedAt stays set, so the booking cannot be reviewed again.
      await Review.deleteOne({ ownerId: r.ownerId, _id: r._id }, { session });
      await recomputeVenueRating(String(r.ownerId), String(r.venueId), session);
    });
    res.status(204).end();
  });

  return router;
}
