import type mongoose from 'mongoose';
import { z } from 'zod';
import { MAX_SETUP_TURFS, SPORTS, WEEKDAYS, type OwnerSettings } from '@booking/shared';
import { logActivity } from '../tenancy/activityLog.model';
import { Owner } from '../tenancy/owner.model';
import { pricingSchema } from '../schedule/schemas';
import { checkSports } from '../venues/routes/turfs';
import { isSlugDuplicate, slugTaken, venueFields, venueSlugs } from '../venues/routes/venues';
import { applyPatch, dayHoursSchema, paymentMethodsSchema, weekendDaysSchema } from '../venues/settingsSchema';
import { Turf } from '../venues/turf.model';
import { Venue, type VenueDoc } from '../venues/venue.model';

export const venueSetupSchema = z
  .object({
    venue: z
      .object({
        name: venueFields.name,
        address: venueFields.address,
        city: venueFields.city,
        timezone: venueFields.timezone,
        location: venueFields.location,
        amenities: venueFields.amenities.optional(),
      })
      .strict(),
    turfs: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(60),
            sports: z.array(z.enum(SPORTS)).min(1).transform((s) => [...new Set(s)]),
            indoor: z.boolean(),
            slotLengthMin: z.number().int().min(30).max(240).multipleOf(15),
            pricing: pricingSchema,
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SETUP_TURFS)
      // Turf names are unique per venue, ignoring case (the index's collation).
      .refine((turfs) => new Set(turfs.map((t) => t.name.toLocaleLowerCase())).size === turfs.length, 'Turf names must differ'),
    settings: z
      .object({
        hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayHoursSchema])) as Record<(typeof WEEKDAYS)[number], typeof dayHoursSchema>).strict(),
        weekendDays: weekendDaysSchema,
        paymentMethods: paymentMethodsSchema,
      })
      .strict(),
    publish: z.boolean(),
  })
  .strict();

export type ParsedSetup = z.infer<typeof venueSetupSchema>;

/** Checks what a transaction cannot: every sport is offered on the platform. */
export async function checkSetup(input: ParsedSetup): Promise<void> {
  await checkSports(input.turfs.flatMap((t) => t.sports));
}

type Actor = { ownerId: string; userId: string };

/**
 * Writes one easy-setup venue inside the caller's transaction: the venue, its turfs with prices, and the hours and
 * payment methods, on the owner's settings (`settingsOn: 'owner'`, a brand-new business) or as the venue's own.
 */
export async function writeSetup(
  actor: Actor,
  input: ParsedSetup,
  opts: { slug: string; country: string; currency: string; settingsOn: 'owner' | 'venue'; publish: boolean },
  now: Date,
  session: mongoose.ClientSession,
): Promise<VenueDoc> {
  const { venue: v, settings } = input;
  const [venue] = await Venue.create(
    [
      {
        ownerId: actor.ownerId,
        name: v.name,
        slug: opts.slug,
        address: v.address,
        city: v.city,
        country: opts.country,
        timezone: v.timezone,
        currency: opts.currency,
        location: { type: 'Point', coordinates: [v.location.lng, v.location.lat] },
        photos: [],
        amenities: v.amenities ?? [],
        published: opts.publish,
        settings: opts.settingsOn === 'venue' ? applyPatch({}, settings) : {},
      },
    ],
    { session },
  );
  const venueId = venue!.id as string;
  await logActivity(
    actor,
    {
      action: 'venue.create',
      entity: 'venue',
      entityId: venueId,
      venueId,
      after: { name: venue!.name, slug: opts.slug, country: opts.country, currency: opts.currency },
    },
    now,
    session,
  );

  const turfs = await Turf.create(
    input.turfs.map((t) => ({
      ownerId: actor.ownerId,
      venueId,
      name: t.name,
      sports: t.sports,
      indoor: t.indoor,
      slotLengthMin: t.slotLengthMin,
      settings: {},
      pricing: t.pricing,
    })),
    { session, ordered: true },
  );
  for (const turf of turfs) {
    await logActivity(
      actor,
      {
        action: 'turf.create',
        entity: 'turf',
        entityId: turf.id as string,
        venueId,
        after: { name: turf.name, sports: [...turf.sports], indoor: turf.indoor, active: turf.active, pricing: turf.pricing },
      },
      now,
      session,
    );
  }

  if (opts.settingsOn === 'owner') {
    const owner = (await Owner.findById(actor.ownerId).session(session))!;
    const before = (owner.settings ?? {}) as Partial<OwnerSettings>;
    const after = applyPatch(before, settings);
    owner.set('settings', after);
    owner.markModified('settings');
    await owner.save({ session });
    await logActivity(actor, { action: 'settings.update', entity: 'owner', entityId: actor.ownerId, before, after }, now, session);
  }
  if (opts.publish) {
    await logActivity(actor, { action: 'venue.publish', entity: 'venue', entityId: venueId, venueId, after: { published: true } }, now, session);
  }
  return venue!;
}

/** Runs `attempt` with each link name in turn until one is free; `attempt` opens its own transaction. */
export async function withFreeSlug<T>(name: string, attempt: (slug: string) => Promise<T>): Promise<T> {
  for (const slug of venueSlugs(undefined, name)) {
    try {
      return await attempt(slug);
    } catch (err) {
      if (!isSlugDuplicate(err)) throw err;
    }
  }
  throw slugTaken();
}
