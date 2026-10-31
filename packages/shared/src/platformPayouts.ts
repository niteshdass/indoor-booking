import type { FeePayer } from './platformFee';
import type { ManualWallet } from './wallets';

/** Where an owner sends the platform fee: the admin's bKash or Nagad, or by card through Stripe. */
export const PAYOUT_METHODS = ['bkash', 'nagad', 'stripe'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYOUT_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * What an owner owes the platform in one currency, in minor units. `balance` is owed − paid (negative is a
 * credit); pending payouts do not reduce it, but they do reduce `payable` = max(0, balance − pending).
 */
export type PlatformBalanceJson = { currency: string; owed: number; paid: number; pending: number; balance: number; payable: number };

export type PlatformPayoutJson = {
  id: string;
  ownerId: string;
  /** Set on the admin queue. */
  ownerName?: string;
  currency: string;
  /** Minor units of `currency`. */
  amount: number;
  method: PayoutMethod;
  trxId: string | null;
  senderNumber: string | null;
  status: PayoutStatus;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

/** The owner's platform-fee page. */
export type OwnerPlatformFeeJson = {
  feeActive: boolean;
  payer: FeePayer;
  balances: PlatformBalanceJson[];
  payouts: PlatformPayoutJson[];
  methods: { bkash: ManualWallet | null; nagad: ManualWallet | null; stripe: { publishableKey: string } | null };
};

/** `POST /owners/:ownerId/platform-payouts/stripe`: the pending payout and what Stripe.js needs to pay it. */
export type OwnerStripePayoutJson = { payout: PlatformPayoutJson; clientSecret: string; publishableKey: string };

export type AdminPayoutsJson = { payouts: PlatformPayoutJson[]; nextBefore: string | null };
