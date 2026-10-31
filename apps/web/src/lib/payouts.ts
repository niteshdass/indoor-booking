import { STRIPE_PAYOUT_HOLD_MS, type PlatformPayoutJson } from '@booking/shared';
import type { Tone } from '../components/ui/Badge';

/** bKash and Nagad are checked by hand; card payouts are settled by the Stripe webhook only. */
export const isManualPayout = (p: PlatformPayoutJson) => p.method !== 'stripe';

/** What a payout's status badge says: a card payout left pending past the hold was never paid and no longer counts. */
export type PayoutShown = PlatformPayoutJson['status'] | 'stale';

export const payoutShown = (p: PlatformPayoutJson, now: number): PayoutShown =>
  p.status === 'pending' && !isManualPayout(p) && now - Date.parse(p.createdAt) > STRIPE_PAYOUT_HOLD_MS ? 'stale' : p.status;

/** Badge tone per shown status; the label is `admin.payouts.status.<shown>`, shared by the admin and owner pages. */
export const PAYOUT_TONE: Record<PayoutShown, Tone> = { pending: 'warning', confirmed: 'success', rejected: 'danger', stale: 'neutral' };
