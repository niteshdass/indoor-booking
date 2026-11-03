import type { AddonLine, BookingStatus, ManualWallet, PaymentStatus, PlatformFeeSnapshot, WalletProvider } from '@booking/shared';

/**
 * `GET /me/bookings/:id` → `booking` (apps/api/src/bookings/booking.model.ts `bookingJson` + playerJson.ts).
 * Only the fields the app reads; mirrors apps/web/src/lib/types.ts `BookingJson`.
 */
export type PlayerBooking = {
  id: string;
  reference: string;
  turfId: string;
  businessDate: string;
  slots: { startAt: string; endAt: string; price: number }[];
  addons: AddonLine[];
  currency: string;
  subtotal: number;
  addonsTotal: number;
  total: number;
  advanceRequired: number;
  platformFee: PlatformFeeSnapshot | null;
  amountPaid: number;
  amountRefunded: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  holdExpiresAt: string | null;
  venue: { slug: string; name: string; address: string; city: string; timezone: string } | null;
  turf: { name: string } | null;
  manualPayment: { provider: WalletProvider; trxId: string; amount: number; status: string; submittedAt: string } | null;
};

/** `GET /bookings/:id/payment-options` (apps/api/src/bookings/routes/public.ts). */
export type PaymentOptions = {
  wallets: ManualWallet[];
  card: boolean;
  sslcommerz?: boolean;
  amount: number;
  currency: string;
  holdExpiresAt: string | null;
};

/** `POST /bookings/:id/payment` (apps/api/src/payments/intent.ts). */
export type PaymentStart = {
  payment:
    | { id: string; amount: number; currency: string; gateway: 'stripe'; clientSecret: string; publishableKey: string }
    | { id: string; amount: number; currency: string; gateway: 'sslcommerz'; url: string };
  holdExpiresAt: string | null;
};

/** `GET /me/bookings/:id/cancellation` → `preview` (apps/api/src/bookings/cancel.ts `previewCancellation`). */
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
