import mongoose, { type ClientSession } from 'mongoose';
import {
  couponDiscount,
  normalizeCouponCode,
  type CouponRefusal,
  type CouponType,
} from '@booking/shared';
import { AppError } from '../errors';
import { Booking, holdingFilter } from '../bookings/booking.model';
import type { VenueDoc } from '../venues/venue.model';
import { Coupon, type CouponDoc } from './coupon.model';

/** Who is checking out: per-customer limits count a player's bookings, or a guest phone's. */
export type CouponCustomer = { playerId: string } | { phone: string };

const MESSAGES: Record<CouponRefusal, string> = {
  coupon_invalid: 'This promo code is not valid here',
  coupon_not_started: 'This promo code is not active yet',
  coupon_expired: 'This promo code has expired',
  coupon_used_up: 'This promo code has been used up',
  coupon_limit_reached: 'You have already used this promo code',
  coupon_min_subtotal: 'Your booking is below the minimum for this promo code',
};

export const couponError = (code: CouponRefusal, details?: unknown) =>
  new AppError(code === 'coupon_used_up' || code === 'coupon_limit_reached' ? 409 : 400, code, MESSAGES[code], details);

/**
 * Checkouts holding or having used `couponId`: live holds, pending, confirmed, completed and
 * no-show bookings, a group counted once. Expired, rejected and cancelled ones free their use.
 */
export async function couponUses(
  ownerId: string,
  couponIds: string[],
  now: Date,
  opts: { customer?: CouponCustomer; session?: ClientSession | null } = {},
): Promise<Map<string, number>> {
  const out = new Map(couponIds.map((id) => [id, 0]));
  if (couponIds.length === 0) return out;
  const who = !opts.customer
    ? {}
    : 'playerId' in opts.customer
      ? { playerId: new mongoose.Types.ObjectId(opts.customer.playerId) }
      : { 'guest.phone': opts.customer.phone, playerId: null };
  const rows = await Booking.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
    {
      $match: {
        ownerId: new mongoose.Types.ObjectId(ownerId),
        'coupon.couponId': { $in: couponIds.map((id) => new mongoose.Types.ObjectId(id)) },
        ...who,
        $or: [...holdingFilter(now).$or, { status: { $in: ['completed', 'no_show'] } }],
      },
    },
    { $group: { _id: { coupon: '$coupon.couponId', checkout: { $ifNull: ['$groupId', '$_id'] } } } },
    { $group: { _id: '$_id.coupon', n: { $sum: 1 } } },
  ]).session(opts.session ?? null);
  for (const r of rows) out.set(String(r._id), r.n);
  return out;
}

/** What a checkout gets off and the coupon that gives it. */
export type AppliedCoupon = { couponId: string; code: string; type: CouponType; value: number; discount: number };

/**
 * The coupon `code` of the venue's owner, if it can be used at `venue` now on a checkout whose
 * slots and add-ons come to `gross`; else the reason as an AppError. Reads uses outside any lock:
 * assertCouponRoom under lockCoupon inside the booking transaction is the real check.
 */
export async function applyCoupon(input: {
  venue: VenueDoc;
  code: string;
  gross: number;
  now: Date;
  customer?: CouponCustomer;
}): Promise<{ coupon: CouponDoc; applied: AppliedCoupon }> {
  const { venue, gross, now, customer } = input;
  const ownerId = String(venue.ownerId);
  const coupon = await Coupon.findOne({ ownerId, code: normalizeCouponCode(input.code) });
  const venueOk = coupon && (coupon.venueIds.length === 0 || coupon.venueIds.some((id) => String(id) === String(venue._id)));
  // A fixed amount is in the owner's currency; a venue priced in another cannot take it.
  const currencyOk = coupon && (coupon.type === 'percent' || coupon.currency === venue.currency);
  if (!coupon || !coupon.active || !venueOk || !currencyOk) throw couponError('coupon_invalid');
  if (coupon.validFrom && coupon.validFrom.getTime() > now.getTime()) throw couponError('coupon_not_started');
  if (coupon.validUntil && coupon.validUntil.getTime() <= now.getTime()) throw couponError('coupon_expired');
  if (gross < coupon.minSubtotal) throw couponError('coupon_min_subtotal', { minSubtotal: coupon.minSubtotal });
  await assertCouponRoom(coupon, now, null, customer);
  const discount = couponDiscount(
    { type: coupon.type, value: coupon.value, maxDiscount: coupon.maxDiscount ?? null, minSubtotal: coupon.minSubtotal },
    gross,
  );
  return { coupon, applied: { couponId: String(coupon._id), code: coupon.code, type: coupon.type, value: coupon.value, discount } };
}

/** Refuses a coupon with no uses left, overall or for `customer`. */
export async function assertCouponRoom(
  coupon: CouponDoc,
  now: Date,
  session: ClientSession | null,
  customer?: CouponCustomer,
): Promise<void> {
  const ownerId = String(coupon.ownerId);
  const id = String(coupon._id);
  if (coupon.maxUses !== null && coupon.maxUses !== undefined) {
    const used = (await couponUses(ownerId, [id], now, { session })).get(id)!;
    if (used >= coupon.maxUses) throw couponError('coupon_used_up');
  }
  if (customer && coupon.maxUsesPerCustomer !== null && coupon.maxUsesPerCustomer !== undefined) {
    const used = (await couponUses(ownerId, [id], now, { session, customer })).get(id)!;
    if (used >= coupon.maxUsesPerCustomer) throw couponError('coupon_limit_reached');
  }
}

/**
 * Serializes checkouts using one coupon, like lockTurf: a concurrent writer WriteConflicts and its
 * retry counts the winner's booking. A coupon switched off or deleted meanwhile is invalid.
 */
export async function lockCoupon(coupon: CouponDoc, at: Date, session: ClientSession): Promise<void> {
  const { matchedCount } = await Coupon.updateOne(
    { ownerId: coupon.ownerId, _id: coupon._id, active: true },
    { $set: { updatedAt: at } },
    { session },
  );
  if (matchedCount !== 1) throw couponError('coupon_invalid');
}
