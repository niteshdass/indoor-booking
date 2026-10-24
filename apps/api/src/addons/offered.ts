import type { OfferedAddon } from '@booking/shared';
import type { TurfDoc } from '../venues/turf.model';
import type { VenueDoc } from '../venues/venue.model';
import { Addon } from './addon.model';
import { AddonAssignment } from './assignment.model';

/** The add-ons a turf offers: its own assignment, else the venue-level one, when enabled and priced in the venue's currency. */
export async function offeredAddons(ownerId: string, venue: VenueDoc, turf: TurfDoc): Promise<OfferedAddon[]> {
  const assignments = await AddonAssignment.find({
    ownerId,
    venueId: venue._id,
    turfId: { $in: [null, turf._id] },
  });
  const byAddon = new Map<string, { venue?: (typeof assignments)[number]; turf?: (typeof assignments)[number] }>();
  for (const a of assignments) {
    const key = String(a.addonId);
    const entry = byAddon.get(key) ?? {};
    if (a.turfId == null) entry.venue = a;
    else entry.turf = a;
    byAddon.set(key, entry);
  }
  const deciding = [...byAddon.entries()].filter(([, e]) => (e.turf ?? e.venue)!.enabled);
  if (deciding.length === 0) return [];
  const addons = await Addon.find({ ownerId, _id: { $in: deciding.map(([id]) => id) } })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, _id: 1 });
  const out: OfferedAddon[] = [];
  for (const addon of addons) {
    const e = byAddon.get(addon.id as string)!;
    if (addon.autoApply?.outdoorOnly && turf.indoor) continue;
    const unitPrice =
      e.turf?.priceOverride ?? e.venue?.priceOverride ?? (addon.currency === venue.currency ? addon.price : null);
    if (unitPrice == null) continue;
    out.push({
      addonId: addon.id as string,
      name: addon.name,
      pricingType: addon.pricingType,
      unitPrice,
      maxQuantity: addon.maxQuantity,
      stock: e.venue?.stock ?? addon.stock ?? null,
      autoApply: addon.autoApply ?? null,
    });
  }
  return out;
}

export function offeredJson(o: OfferedAddon) {
  return {
    id: o.addonId,
    name: o.name,
    pricingType: o.pricingType,
    unitPrice: o.unitPrice,
    maxQuantity: o.maxQuantity,
    autoApply: o.autoApply,
  };
}
