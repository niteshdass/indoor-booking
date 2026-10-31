import { currencyExponent, percentOf } from './money';
import type { BookingStatus } from './statuses';

export const PLATFORM_FEE_MODES = ['free', 'fixed', 'percent'] as const;
export type PlatformFeeMode = (typeof PLATFORM_FEE_MODES)[number];

export const FEE_PAYERS = ['owner', 'player'] as const;
export type FeePayer = (typeof FEE_PAYERS)[number];

export const PLATFORM_FEE_MAX_PERCENT = 50;

/** `fixed` is in major units (applied in each booking's own currency); `percent` is 0..50. */
export type PlatformFeeSettings = {
  mode: PlatformFeeMode;
  fixed: number | null;
  percent: number | null;
  payer: FeePayer;
};

export const DEFAULT_PLATFORM_FEE: PlatformFeeSettings = {
  mode: 'free',
  fixed: null,
  percent: null,
  payer: 'owner',
};

/** The fee frozen onto a booking; `amount` is in minor units of the booking's currency. */
export type PlatformFeeSnapshot = {
  mode: 'fixed' | 'percent';
  value: number;
  payer: FeePayer;
  amount: number;
};

/** Statuses in which a booking owes its fee to the platform. */
export const FEE_OWING_STATUSES: readonly BookingStatus[] = [
  'pending',
  'confirmed',
  'completed',
  'no_show',
];

export const OWNER_APPROVAL_MODES = ['manual', 'automatic'] as const;
export type OwnerApprovalMode = (typeof OWNER_APPROVAL_MODES)[number];

/** `base` is subtotal + addonsTotal in minor units. Null when there is no fee or it rounds to zero. */
export function platformFeeFor(
  settings: PlatformFeeSettings,
  base: number,
  currency: string,
): PlatformFeeSnapshot | null {
  let value: number;
  let amount: number;
  if (settings.mode === 'fixed' && settings.fixed !== null) {
    value = settings.fixed;
    amount = Math.round(value * 10 ** currencyExponent(currency));
  } else if (settings.mode === 'percent' && settings.percent !== null) {
    value = settings.percent;
    amount = percentOf(base, value);
  } else {
    return null;
  }
  if (amount <= 0) return null;
  return { mode: settings.mode, value, payer: settings.payer, amount };
}
