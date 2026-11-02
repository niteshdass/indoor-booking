import { REVIEW_WINDOW_DAYS, reschedulableUntil, type BookingStatus, type OwnReviewJson, type ReschedulePolicy, type WalletProvider } from '@booking/shared';
import { User } from '../auth/user.model';
import { ownReviewJson } from '../reviews/json';
import { Review } from '../reviews/review.model';
import { Venue } from '../venues/venue.model';
import { Turf } from '../venues/turf.model';
import { bookingJson, type BookingDoc } from './booking.model';
import { Payment, type PaymentDoc } from './payment.model';

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
  /** Last moment the player may move the booking themselves; null when they cannot (any more). */
  reschedulableUntil: string | null;
  /** The latest wallet payment the player submitted for this booking (a group's, on its lead); never the sender number. */
  manualPayment: PlayerManualPayment | null;
};

export type PlayerManualPayment = {
  provider: WalletProvider;
  trxId: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  submittedAt: string;
};

const manualPaymentJson = (p: PaymentDoc): PlayerManualPayment => ({
  provider: p.provider as WalletProvider,
  trxId: p.trxId!,
  amount: p.amount,
  status: p.status as PlayerManualPayment['status'],
  submittedAt: p.createdAt.toISOString(),
});

const DAY_MS = 86_400_000;

function reviewableUntil(b: BookingDoc, now: Date): string | null {
  if (b.status !== 'completed' || !b.completedAt || b.reviewedAt || !b.playerId) return null;
  const until = new Date(b.completedAt.getTime() + REVIEW_WINDOW_DAYS * DAY_MS);
  return until.getTime() >= now.getTime() ? until.toISOString() : null;
}

function playerMoveUntil(b: BookingDoc, now: Date): string | null {
  if (!b.playerId) return null;
  const policy = (b.policySnapshot?.reschedule ?? null) as ReschedulePolicy | null;
  const until = reschedulableUntil(
    policy,
    { status: b.status as BookingStatus, startAt: b.startAt, moves: b.playerMoves ?? 0, series: !!b.seriesId },
    now,
  );
  return until && until >= now ? until.toISOString() : null;
}

/**
 * Booking JSON plus the venue and turf names and the player's review, for player-facing responses.
 * `$in` queries for the whole list (reviewer names only when there are reviews).
 */
export async function playerBookingsJson(bookings: BookingDoc[], now: Date): Promise<PlayerBooking[]> {
  if (bookings.length === 0) return [];
  const ids = (key: 'venueId' | 'turfId') => [...new Set(bookings.map((b) => String(b[key])))];
  const groupIds = [...new Set(bookings.filter((b) => b.groupId).map((b) => String(b.groupId)))];
  const [venues, turfs, reviews, manual] = await Promise.all([
    Venue.find({ _id: { $in: ids('venueId') } }).setOptions({ crossTenant: true }),
    Turf.find({ _id: { $in: ids('turfId') } }).setOptions({ crossTenant: true }),
    Review.find({ bookingId: { $in: bookings.map((b) => b._id) } }).setOptions({ crossTenant: true }),
    // Only a lead row carries the TrxID; the rest of its group share its groupId.
    Payment.find({
      ownerId: { $in: [...new Set(bookings.map((b) => String(b.ownerId)))] },
      kind: 'manual',
      trxId: { $type: 'string' },
      $or: [{ bookingId: { $in: bookings.map((b) => b._id) } }, ...(groupIds.length ? [{ groupId: { $in: groupIds } }] : [])],
    })
      .setOptions({ crossTenant: true })
      .sort({ _id: -1 }),
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
    const m = manual.find((p) => String(p.bookingId) === String(b._id) || (b.groupId && String(p.groupId) === String(b.groupId)));
    return {
      ...bookingJson(b),
      venue: v ? { slug: v.slug, name: v.name, address: v.address, city: v.city, timezone: v.timezone } : null,
      turf: t ? { name: t.name } : null,
      review: r ? ownReviewJson(r, nameById.get(String(r.playerId)), now) : null,
      reviewableUntil: reviewableUntil(b, now),
      reschedulableUntil: playerMoveUntil(b, now),
      manualPayment: m ? manualPaymentJson(m) : null,
    };
  });
}

export async function playerBookingJson(b: BookingDoc, now: Date): Promise<PlayerBooking> {
  return (await playerBookingsJson([b], now))[0]!;
}
