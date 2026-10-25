import { REVIEW_WINDOW_DAYS, type OwnReviewJson } from '@booking/shared';
import { User } from '../auth/user.model';
import { ownReviewJson } from '../reviews/json';
import { Review } from '../reviews/review.model';
import { Venue } from '../venues/venue.model';
import { Turf } from '../venues/turf.model';
import { bookingJson, type BookingDoc } from './booking.model';

export type PlayerPlace = {
  venue: { slug: string; name: string; address: string; city: string; timezone: string };
  turf: { name: string };
};

export type PlayerBooking = ReturnType<typeof bookingJson> & {
  venue: PlayerPlace['venue'] | null;
  turf: PlayerPlace['turf'] | null;
  /** The player's own review of this booking. */
  review: OwnReviewJson | null;
  /** Last moment a review can be posted; null when it cannot (any more). */
  reviewableUntil: string | null;
};

const DAY_MS = 86_400_000;

function reviewableUntil(b: BookingDoc, now: Date): string | null {
  if (b.status !== 'completed' || !b.completedAt || b.reviewedAt || !b.playerId) return null;
  const until = new Date(b.completedAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS);
  return until.getTime() >= now.getTime() ? until.toISOString() : null;
}

/**
 * Booking JSON plus the venue and turf names and the player's review, for player-facing responses.
 * `$in` queries for the whole list (reviewer names only when there are reviews).
 */
export async function playerBookingsJson(bookings: BookingDoc[], now: Date): Promise<PlayerBooking[]> {
  if (bookings.length === 0) return [];
  const ids = (key: 'venueId' | 'turfId') => [...new Set(bookings.map((b) => String(b[key])))];
  const [venues, turfs, reviews] = await Promise.all([
    Venue.find({ _id: { $in: ids('venueId') } }).setOptions({ crossTenant: true }),
    Turf.find({ _id: { $in: ids('turfId') } }).setOptions({ crossTenant: true }),
    Review.find({ bookingId: { $in: bookings.map((b) => b._id) } }).setOptions({ crossTenant: true }),
  ]);
  const authors = reviews.length
    ? await User.find({ _id: { $in: [...new Set(reviews.map((r) => String(r.playerId)))] } }).select('name')
    : [];
  const nameById = new Map(authors.map((u) => [String(u._id), u.name]));
  const reviewByBooking = new Map(reviews.map((r) => [String(r.bookingId), r]));
  const venueById = new Map(venues.map((v) => [String(v._id), v]));
  const turfById = new Map(turfs.map((t) => [String(t._id), t]));
  return bookings.map((b) => {
    const v = venueById.get(String(b.venueId));
    const t = turfById.get(String(b.turfId));
    const r = reviewByBooking.get(String(b._id));
    return {
      ...bookingJson(b),
      venue: v ? { slug: v.slug, name: v.name, address: v.address, city: v.city, timezone: v.timezone } : null,
      turf: t ? { name: t.name } : null,
      review: r ? ownReviewJson(r, nameById.get(String(r.playerId)), now) : null,
      reviewableUntil: reviewableUntil(b, now),
    };
  });
}

export async function playerBookingJson(b: BookingDoc, now: Date): Promise<PlayerBooking> {
  return (await playerBookingsJson([b], now))[0]!;
}
