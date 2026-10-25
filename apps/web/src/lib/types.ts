import type { OwnReviewJson, RatingSummary, Amenity, AddonLine, AddonPricingType, AutoApplyRule, BookingStatus, PaymentStatus, SlotStatus, Sport } from '@booking/shared';

export type { SearchResult, SearchResponse } from '@booking/shared';

export type PublicUser = {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
};

export type AuthResponse = { user: PublicUser; accessToken: string; refreshToken: string };

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
  total: number;
  advanceRequired: number;
};

export type QuoteResponse = { quote: QuoteJson; guestAllowed: boolean; guestOtpRequired: boolean };

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
  amountPaid: number;
  amountRefunded: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  holdExpiresAt: string | null;
  source: 'online' | 'walkin';
  playerId: string | null;
  guest: { name: string; phone: string } | null;
  seriesId: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  cancelledBy: 'player' | 'guest' | 'staff' | null;
  cancelReason: string | null;
  createdAt: string;
  completedAt: string | null;
  review: OwnReviewJson | null;
  reviewableUntil: string | null;
  venue: PlayerVenue | null;
  turf: { name: string } | null;
};

export type RefundJson = {
  id: string;
  paymentId: string;
  method: 'card' | 'cash';
  amount: number;
  currency: string;
  reason: 'late_payment' | 'duplicate_payment' | 'amount_mismatch' | 'cancellation';
  ruleApplied: { minHoursBefore: number | null; percent: number } | null;
  status: 'pending' | 'succeeded' | 'failed';
  failureCode: string | null;
  retryOf: string | null;
  createdAt: string;
};

export type CancellationPreview = {
  percent: number;
  amount: number;
  rule: { minHoursBefore: number | null; percent: number } | null;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  card: number;
  cash: number;
};

export type PaymentStart = {
  payment: { id: string; amount: number; currency: string; gateway: 'stripe'; clientSecret: string; publishableKey: string };
  holdExpiresAt: string;
};

export type OtpSent = { expiresInSec: number; resendInSec: number };
