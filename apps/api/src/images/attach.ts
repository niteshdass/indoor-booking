import mongoose, { type ClientSession, type Types } from 'mongoose';
import { AppError } from '../errors';
import { Image } from './image.model';

/** An upload no venue has claimed after this long is deleted. */
export const PENDING_IMAGE_TTL_MS = 24 * 60 * 60_000;

/** Ids of the uploaded images among `urls` (those under `base`); other URLs are external and ignored. */
export function uploadedIds(urls: readonly string[], base: string): string[] {
  return [...new Set(urls.filter((u) => u.startsWith(base)).map((u) => u.slice(base.length)))];
}

const invalidPhoto = () => new AppError(400, 'invalid_photo', 'A photo was not uploaded by this team');

/**
 * Checks that every id is an image this owner uploaded that is free or already on `venueId` (null for a new
 * venue), so a venue can't show another team's upload or take a photo away from another venue.
 */
export async function assertOwnImages(ownerId: string, ids: readonly string[], venueId: Types.ObjectId | null, session?: ClientSession): Promise<void> {
  if (ids.length === 0) return;
  if (!ids.every((id) => mongoose.isValidObjectId(id))) throw invalidPhoto();
  const found = await Image.countDocuments({
    ownerId,
    _id: { $in: ids },
    venueId: venueId ? { $in: [null, venueId] } : null,
  }).session(session ?? null);
  if (found !== ids.length) throw invalidPhoto();
}

/** Attaches `ids` to the venue and deletes the venue's images it no longer lists. */
export async function syncVenueImages(ownerId: string, venueId: Types.ObjectId, ids: readonly string[], session: ClientSession): Promise<void> {
  if (ids.length > 0) await Image.updateMany({ ownerId, _id: { $in: ids } }, { $set: { venueId } }, { session });
  await Image.deleteMany({ ownerId, venueId, _id: { $nin: ids } }, { session });
}

/** Deletes uploads that no venue claimed within PENDING_IMAGE_TTL_MS; returns how many. */
export async function sweepPendingImages(now: Date): Promise<number> {
  const { deletedCount } = await Image.deleteMany({ venueId: null, createdAt: { $lt: new Date(now.getTime() - PENDING_IMAGE_TTL_MS) } }).setOptions({
    crossTenant: true,
  });
  return deletedCount;
}
