import mongoose, { type ClientSession } from 'mongoose';
import type { RatingSummary } from '@booking/shared';
import { Venue } from '../venues/venue.model';
import { Review } from './review.model';

/** Recomputes a venue's rating from its visible reviews and stores it on the venue. */
export async function recomputeVenueRating(
  ownerId: string,
  venueId: string,
  session: ClientSession,
): Promise<{ average: number | null; count: number }> {
  const [row] = await Review.aggregate<{ avg: number; count: number }>([
    {
      $match: {
        ownerId: new mongoose.Types.ObjectId(ownerId),
        venueId: new mongoose.Types.ObjectId(venueId),
        moderation: 'visible',
      },
    },
    { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
  ]).session(session);
  const rating = row
    ? { average: Math.round(row.avg * 10) / 10, count: row.count }
    : { average: null, count: 0 };
  await Venue.updateOne({ _id: venueId, ownerId }, { $set: { rating } }, { session });
  return rating;
}

/** Null when there are no ratings yet. */
export function ratingJson(
  r: { average?: number | null; count?: number } | null | undefined,
): RatingSummary | null {
  if (!r?.count || r.average == null) return null;
  return { average: r.average, count: r.count };
}
