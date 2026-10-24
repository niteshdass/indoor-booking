import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../errors';
import { permissionsCover, type TenantContext } from '../tenancy/context';
import { Addon, type AddonDoc } from './addon.model';

export const addonNotFound = () => new AppError(404, 'not_found', 'Add-on not found');

/** The add-on if it belongs to this tenant; else 404. */
export async function scopedAddon(t: TenantContext, addonId: string): Promise<AddonDoc> {
  const addon = mongoose.isValidObjectId(addonId) ? await Addon.findOne({ ownerId: t.ownerId, _id: addonId }) : null;
  if (!addon) throw addonNotFound();
  return addon;
}

/** Like lockTurf: serializes concurrent writers of one add-on; 404s when it is gone. */
export async function lockAddon(
  t: Pick<TenantContext, 'ownerId'>,
  addonId: string,
  at: Date,
  session: ClientSession,
): Promise<void> {
  const { matchedCount } = await Addon.updateOne(
    { ownerId: t.ownerId, _id: addonId },
    { $set: { updatedAt: at } },
    { session },
  );
  if (matchedCount !== 1) throw addonNotFound();
}

/** The catalogue is owner-wide: writing it needs addon.manage on all venues. */
export function assertCatalogueWriter(t: TenantContext): void {
  if (!permissionsCover(t, ['addon.manage']) || t.venueIds !== 'all') {
    throw new AppError(403, 'forbidden', 'You do not have permission to do this');
  }
}
