import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors';
import type { TenantContext } from '../tenancy/context';
import { Turf, type TurfDoc } from './turf.model';
import { Venue, type VenueDoc } from './venue.model';
import { scopedVenue } from './routes/venues';

/**
 * Writes the venue document inside the transaction so concurrent turf and publish changes on the
 * same venue conflict (and retry) instead of both passing their checks. 404s when the venue is gone,
 * e.g. deleted between the route's lookup and this transaction (or its retry).
 */
export async function lockVenue(
  t: Pick<TenantContext, 'ownerId'>,
  venueId: string,
  at: Date,
  session: ClientSession,
): Promise<void> {
  const { matchedCount } = await Venue.updateOne(
    { ownerId: t.ownerId, _id: venueId },
    { $set: { updatedAt: at } },
    { session },
  );
  if (matchedCount !== 1) throw venueNotFound();
}

export const venueNotFound = () => new AppError(404, 'not_found', 'Venue not found');

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

export const turfNotFound = () => new AppError(404, 'not_found', 'Turf not found');

/** The turf and its venue, if both belong to this tenant and the venue is in the member's scope; else 404. */
export async function scopedTurf(
  t: TenantContext,
  venueId: string,
  turfId: string,
): Promise<{ venue: VenueDoc; turf: TurfDoc }> {
  const venue = await scopedVenue(t, venueId);
  const turf = mongoose.isValidObjectId(turfId)
    ? await Turf.findOne({ ownerId: t.ownerId, venueId: venue._id, _id: turfId })
    : null;
  if (!turf) throw turfNotFound();
  return { venue, turf };
}

/** Like lockVenue, for the turf: serializes concurrent writers of one turf's schedule data. */
export async function lockTurf(
  t: Pick<TenantContext, 'ownerId'>,
  turfId: string,
  at: Date,
  session: ClientSession,
): Promise<void> {
  const { matchedCount } = await Turf.updateOne(
    { ownerId: t.ownerId, _id: turfId },
    { $set: { updatedAt: at } },
    { session },
  );
  if (matchedCount !== 1) throw turfNotFound();
}
