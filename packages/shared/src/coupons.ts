import { assertMinor, percentOf } from './money';

export const COUPON_TYPES = ['percent', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** Codes are stored and matched upper case: 3 to 24 letters, digits, - or _. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,24}$/;

export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

/** What a coupon takes off: `value` is a percent (0.01–100) or minor units of the owner's currency. */
export type CouponTerms = {
  type: CouponType;
  value: number;
  /** Minor units; the most a percent coupon takes off one checkout. Null: no cap. */
  maxDiscount: number | null;
  /** Minor units; the checkout's slots and add-ons must come to at least this. 0: no minimum. */
  minSubtotal: number;
};

/** Why a coupon cannot be used, as an API error code. */
export type CouponRefusal =
  | 'coupon_invalid'
  | 'coupon_not_started'
  | 'coupon_expired'
  | 'coupon_used_up'
  | 'coupon_limit_reached'
  | 'coupon_min_subtotal';

/** The discount on a checkout whose slots and add-ons come to `base`; never more than `base`. */
export function couponDiscount(terms: CouponTerms, base: number): number {
  assertMinor(base);
  const raw = terms.type === 'percent' ? percentOf(base, terms.value) : terms.value;
  const capped = terms.type === 'percent' && terms.maxDiscount !== null ? Math.min(raw, terms.maxDiscount) : raw;
  return Math.min(capped, base);
}

/**
 * Splits a checkout's discount across its bookings in proportion to their bases, flooring each
 * share and handing the remainder out from the first booking on, so the shares sum to `discount`
 * and none passes its booking's base.
 */
export function splitDiscount(discount: number, bases: number[]): number[] {
  assertMinor(discount);
  const sum = bases.reduce((n, b) => n + b, 0);
  if (sum === 0 || discount === 0) return bases.map(() => 0);
  const shares = bases.map((b) => Math.floor((discount * b) / sum));
  let left = discount - shares.reduce((n, s) => n + s, 0);
  for (let i = 0; left > 0 && i < shares.length; i++) {
    const room = bases[i]! - shares[i]!;
    const add = Math.min(room, left);
    shares[i] = shares[i]! + add;
    left -= add;
  }
  return shares;
}

/** A coupon as the owner dashboard reads and writes it. Dates are ISO instants. */
export type CouponJson = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  currency: string;
  /** Empty: every venue of the owner. */
  venueIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  /** Checkouts the coupon may be used on in all; null: no limit. */
  maxUses: number | null;
  /** Checkouts one player or guest phone may use it on; null: no limit. */
  maxUsesPerCustomer: number | null;
  minSubtotal: number;
  maxDiscount: number | null;
  active: boolean;
  /** Checkouts holding or having used the coupon now (expired, rejected and cancelled ones free theirs). */
  uses: number;
  createdAt: string;
};

/** The coupon on a booking: its code and this booking's share of the discount, in minor units. */
export type BookingCoupon = { couponId: string; code: string; discount: number };
