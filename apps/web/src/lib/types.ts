import type { OwnReviewJson, RatingSummary, Amenity, AddonLine, AddonPricingType, AutoApplyRule, BookingCoupon, BookingStatus, CouponType, ManualWallet, PlatformFeeSnapshot, WalletProvider, PaymentStatus, SlotStatus, Sport } from '@booking/shared';

export type { SearchResult, SearchResponse } from '@booking/shared';

export type PublicUser = {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
  /** Holds a platform role: the Admin portal is open to them. */
  platformAdmin: boolean;
};

/** The refresh token never appears here: it travels only in the httpOnly `rt` cookie. */
export type AuthResponse = { user: PublicUser; accessToken: string };

export type PublicTurf = { id: string; name: string; sports: Sport[]; indoor: boolean; slotLengthMin: number };

export type PublicVenue = {
  slug: string;
  name: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  location: { lat: number; lng: number };
  photos: { url: string; alt?: string }[];
  amenities: Amenity[];
  turfs: PublicTurf[];
  rating: RatingSummary | null;
};

export type SlotJson = {
  startAt: string;
  endAt: string;
  localStart: string;
  localEnd: string;
  price: number | null;
  status: SlotStatus;
};

export type SlotDay = {
  businessDate: string;
  currency: string;
  status: 'open' | 'closed' | 'outside_window';
  slots: SlotJson[];
};

export type OfferedAddonJson = {
  id: string;
  name: string;
  pricingType: AddonPricingType;
  unitPrice: number;
  maxQuantity: number;
  autoApply: AutoApplyRule | null;
};

export type QuoteJson = {
  currency: string;
  slots: { startAt: string; endAt: string; price: number }[];
  addons: AddonLine[];
  subtotal: number;
  addonsTotal: number;
  /** Minor units a promo code takes off the slots and add-ons; 0 without one. Already out of `total`. */
  discount: number;
  total: number;
  advanceRequired: number;
  /** Frozen at booking time; null when no fee applies. A player-paid fee is already in `total`. */
  platformFee: PlatformFeeSnapshot | null;
};

/** The promo code a quote applied; `discount` is for the whole checkout (each item's quote holds its share). */
export type QuoteCoupon = { code: string; type: CouponType; value: number; discount: number };

/** Ways to pay online at a venue: manual wallet providers, card (Stripe), online checkout (SSLCommerz). */
export type OfferedMethods = { wallets: WalletProvider[]; card: boolean; sslcommerz?: boolean };

export type QuoteResponse = {
  quote: QuoteJson;
  guestAllowed: boolean;
  guestOtpRequired: boolean;
  /** What the venue takes online: wallet providers, card (Stripe) and online checkout (SSLCommerz). */
  paymentMethods?: OfferedMethods;
  /** Several bookings at once: every one (the first included) and the sums across them. */
  items?: { turfId: string; date: string; quote: QuoteJson }[];
  total?: number;
  advanceRequired?: number;
  /** Null (or absent) without a promo code. */
  coupon?: QuoteCoupon | null;
};

/** Venue summary on player booking responses. */
export type PlayerVenue = { slug: string; name: string; address: string; city: string; timezone: string };

/** Mirrors the API's `bookingJson` plus the player venue and turf from `playerBookingsJson`. */
export type BookingJson = {
  id: string;
  reference: string;
  venueId: string;
  turfId: string;
  businessDate: string;
  slots: { startAt: string; endAt: string; price: number }[];
  addons: AddonLine[];
  currency: string;
  subtotal: number;
  addonsTotal: number;
  total: number;
  advanceRequired: number;
  /** The promo code used and this booking's share of its discount; `total` is already net of it. */
  coupon: BookingCoupon | null;
  /** Null for walk-ins, Free mode, or a fee that rounds to nothing. A player-paid fee is already in `total`. */
  platformFee: PlatformFeeSnapshot | null;
  amountPaid: number;
  amountRefunded: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  holdExpiresAt: string | null;
  source: 'online' | 'walkin';
  playerId: string | null;
  guest: { name: string; phone: string } | null;
  seriesId: string | null;
  /** Shared by the bookings of one multi-day checkout. */
  groupId: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  cancelledBy: 'player' | 'guest' | 'staff' | null;
  cancelReason: string | null;
  createdAt: string;
  completedAt: string | null;
  review: OwnReviewJson | null;
  reviewableUntil: string | null;
  /** Times the booking was moved (by the player or staff); 0 when never. */
  rescheduleCount: number;
  /** When it was last moved; null when never. */
  rescheduledAt: string | null;
  /** Last moment the player may move it themselves; null when they cannot (any more). */
  reschedulableUntil: string | null;
  venue: PlayerVenue | null;
  turf: { name: string } | null;
  /** The wallet payment the player sent, if any; never the sender number. */
  manualPayment?: ManualPaymentJson | null;
};

export type ManualPaymentJson = {
  provider: WalletProvider;
  trxId: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  submittedAt: string;
};

/** `GET /bookings/:id/payment-options`; `amount` is the whole group's remaining advance. */
export type PaymentOptions = {
  wallets: ManualWallet[];
  /** Stripe card payments. */
  card: boolean;
  /** SSLCommerz hosted checkout (bKash, Nagad, Rocket, cards). */
  sslcommerz?: boolean;
  amount: number;
  currency: string;
  holdExpiresAt: string | null;
};

export type RefundJson = {
  id: string;
  paymentId: string;
  method: 'card' | 'cash' | 'wallet';
  amount: number;
  currency: string;
  reason: 'late_payment' | 'duplicate_payment' | 'amount_mismatch' | 'cancellation' | 'overpayment';
  ruleApplied: { minHoursBefore: number | null; percent: number } | null;
  status: 'pending' | 'succeeded' | 'failed';
  failureCode: string | null;
  retryOf: string | null;
  createdAt: string;
  /** Wallet refunds only (owner responses): what staff send and where; null otherwise. */
  trxId?: string | null;
  provider?: WalletProvider | null;
  sendTo?: string | null;
};

export type CancellationPreview = {
  percent: number;
  amount: number;
  rule: { minHoursBefore: number | null; percent: number } | null;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  card: number;
  wallet: number;
  cash: number;
};

export type PaymentStart = {
  payment:
    | { id: string; amount: number; currency: string; gateway: 'stripe'; clientSecret: string; publishableKey: string }
    | { id: string; amount: number; currency: string; gateway: 'sslcommerz'; url: string };
  holdExpiresAt: string;
};

export type StripePaymentStart = PaymentStart & { payment: Extract<PaymentStart['payment'], { gateway: 'stripe' }> };

export type OtpSent = { expiresInSec: number; resendInSec: number };
