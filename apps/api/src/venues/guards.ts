import type { ClientSession } from 'mongoose';
import type { TenantContext } from '../tenancy/context';
import { Turf } from './turf.model';
import { Venue } from './venue.model';

/**
 * Writes the venue document inside the transaction so concurrent turf and publish changes on the
 * same venue conflict (and retry) instead of both passing their checks.
 */
export async function lockVenue(t: TenantContext, venueId: string, at: Date, session: ClientSession): Promise<void> {
  await Venue.updateOne({ ownerId: t.ownerId, _id: venueId }, { $set: { updatedAt: at } }, { session });
}

export async function activeTurfCount(
  t: TenantContext,
  venueId: string,
  session: ClientSession,
  excludeId?: unknown,
): Promise<number> {
  const filter: Record<string, unknown> = { ownerId: t.ownerId, venueId, active: true };
  if (excludeId !== undefined) filter._id = { $ne: excludeId };
  return Turf.countDocuments(filter).session(session);
}
