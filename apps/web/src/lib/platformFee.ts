import { FEE_OWING_STATUSES, type BookingStatus, type PlatformFeeSnapshot } from '@booking/shared';

/** The part of a booking's fee the player is charged: its amount when the player pays, else 0. */
export function playerFee(fee: PlatformFeeSnapshot | null | undefined): number {
  return fee?.payer === 'player' ? fee.amount : 0;
}

/**
 * The fee an owner pays the platform on a booking: its snapshot when the owner pays and the
 * booking's status still owes it (not rejected, cancelled, expired or awaiting payment), else null.
 */
export function ownerOwedFee(b: { status: BookingStatus; platformFee: PlatformFeeSnapshot | null }): PlatformFeeSnapshot | null {
  return b.platformFee?.payer === 'owner' && FEE_OWING_STATUSES.includes(b.status) ? b.platformFee : null;
}
