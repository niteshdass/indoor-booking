import type { PlatformFeeSnapshot } from '@booking/shared';

/** The part of a booking's fee the player is charged: its amount when the player pays, else 0. */
export function playerFee(fee: PlatformFeeSnapshot | null | undefined): number {
  return fee?.payer === 'player' ? fee.amount : 0;
}
