import {
  resolveSettings,
  withOwnerDefaults,
  type EffectiveSettings,
  type OwnerSettings,
  type TurfSettingsOverride,
  type VenueSettingsOverride,
} from '@booking/shared';
import { Owner } from '../tenancy/owner.model';

/** The owner's settings with defaults filled in. */
export async function ownerSettings(ownerId: string): Promise<OwnerSettings> {
  const owner = await Owner.findById(ownerId, { settings: 1 }).lean();
  return withOwnerDefaults((owner?.settings ?? {}) as Partial<OwnerSettings>);
}

export async function effectiveForVenue(ownerId: string, venue: { settings?: unknown }): Promise<EffectiveSettings> {
  return resolveSettings(await ownerSettings(ownerId), (venue.settings ?? {}) as VenueSettingsOverride);
}

export async function effectiveForTurf(
  ownerId: string,
  venue: { settings?: unknown },
  turf: { settings?: unknown },
): Promise<EffectiveSettings> {
  return resolveSettings(
    await ownerSettings(ownerId),
    (venue.settings ?? {}) as VenueSettingsOverride,
    (turf.settings ?? {}) as TurfSettingsOverride,
  );
}
