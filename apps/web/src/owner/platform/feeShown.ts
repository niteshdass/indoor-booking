import type { OwnerPlatformFeeJson } from '@booking/shared';

/** Free mode shows no fee UI: the page and its nav item only appear while a fee applies or a balance (or credit) is left. */
export function platformFeeShown(fee: OwnerPlatformFeeJson): boolean {
  return fee.feeActive || fee.balances.some((b) => b.balance !== 0 || b.pending > 0);
}
