import type { AddonLine, AddonPricingType, AutoApplyRule, CouponType, PlatformFeeSnapshot, WalletProvider } from '@booking/shared';

/** `GET /venues/:slug/turfs/:turfId/addons` (apps/api/src/addons/routes/publicAddons.ts). */
export type OfferedAddon = {
  id: string;
  name: string;
  pricingType: AddonPricingType;
  unitPrice: number;
  maxQuantity: number;
  /** Non-null: the venue adds it by itself, so the player cannot pick it. */
  autoApply: AutoApplyRule | null;
};

export type QuoteJson = {
  currency: string;
  slots: { startAt: string; endAt: string; price: number }[];
  addons: AddonLine[];
  subtotal: number;
  addonsTotal: number;
  /** Already out of `total`. */
  discount: number;
  total: number;
  advanceRequired: number;
  /** A player-paid fee is already in `total`. */
  platformFee: PlatformFeeSnapshot | null;
};

export type QuoteCoupon = { code: string; type: CouponType; value: number; discount: number };

/** `POST /venues/:slug/turfs/:turfId/quote` (apps/api/src/bookings/routes/public.ts). Mirrors apps/web/src/lib/types.ts. */
export type QuoteResponse = {
  quote: QuoteJson;
  guestAllowed: boolean;
  guestOtpRequired: boolean;
  paymentMethods?: { wallets: WalletProvider[]; card: boolean; sslcommerz?: boolean };
  coupon?: QuoteCoupon | null;
};
