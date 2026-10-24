import { Router } from 'express';
import { z } from 'zod';
import {
  AMENITIES,
  SLUG_RE,
  currencyExponent,
  isTimeZone,
  resolveSettings,
  slugify,
  type EffectiveSettings,
  type VenueSettingsOverride,
} from '@booking/shared';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { Owner } from '../../tenancy/owner.model';
import { tenantRepo } from '../../tenancy/repo';
import { applyPatch, venueSettingsPatchSchema } from '../settingsSchema';
import { effectiveForVenue, ownerSettings } from '../effective';
import { Venue, type VenueDoc } from '../venue.model';
import { Turf } from '../turf.model';
import { Membership } from '../../tenancy/membership.model';
import { activeTurfCount, lockVenue } from '../guards';

const SLUG_MAX = 60;
const MAX_SLUG_SUFFIX = 20;

const isCurrency = (c: string) => {
  try {
    currencyExponent(c);
    return true;
  } catch {
    return false;
  }
};

const text = (max: number) => z.string().trim().min(1).max(max);
const slugSchema = z.string().min(3).max(SLUG_MAX).regex(SLUG_RE, 'Lowercase letters, digits and dashes');
const fields = {
  name: text(100),
  address: text(300),
  city: text(100),
  country: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2, e.g. BD'),
  timezone: z.string().refine(isTimeZone, 'Unknown time zone'),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict(),
  slug: slugSchema,
  photos: z
    .array(
      z
        .object({
          url: z.string().max(2000).url().refine((u) => u.startsWith('https://'), 'Must be an https URL'),
          alt: z.string().trim().max(200).optional(),
        })
        .strict(),
    )
    .max(20),
  amenities: z.array(z.enum(AMENITIES)).transform((a) => [...new Set(a)]),
  settings: venueSettingsPatchSchema,
};

const createSchema = z
  .object({
    ...fields,
    slug: fields.slug.optional(),
    photos: fields.photos.optional(),
    amenities: fields.amenities.optional(),
    settings: fields.settings.optional(),
    currency: z.string().refine(isCurrency, 'Unknown currency').optional(),
  })
  .strict();

export const venuePatchFields = {
  name: fields.name.optional(),
  slug: fields.slug.optional(),
  address: fields.address.optional(),
  city: fields.city.optional(),
  country: fields.country.optional(),
  timezone: fields.timezone.optional(),
  location: fields.location.optional(),
  photos: fields.photos.optional(),
  amenities: fields.amenities.optional(),
  settings: fields.settings.optional(),
  published: z.boolean().optional(),
};
const patchSchema = z.object(venuePatchFields).strict();

export const venueNotFound = () => new AppError(404, 'not_found', 'Venue not found');
const slugTaken = () => new AppError(409, 'slug_taken', 'That link is already taken');

const isSlugDuplicate = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'slug');

type VenueLike = {
  _id: unknown;
  name: string;
  slug: string;
  address: string;
  city: string;
  country: string;
  currency: string;
  timezone: string;
  location?: { coordinates: number[] } | null;
  photos: { url: string; alt?: string | null }[];
  amenities: string[];
  published: boolean;
  settings?: unknown;
  createdAt: Date;
};

// location is required by the schema; the type allows null only because Mongoose infers it so.
const toLatLng = (loc: VenueLike['location']) => ({ lat: loc!.coordinates[1]!, lng: loc!.coordinates[0]! });

export function venueJson(v: VenueLike, effectiveSettings: EffectiveSettings) {
  return {
    id: String(v._id),
    name: v.name,
    slug: v.slug,
    address: v.address,
    city: v.city,
    country: v.country,
    currency: v.currency,
    timezone: v.timezone,
    location: toLatLng(v.location),
    photos: v.photos.map((p) => (p.alt === undefined || p.alt === null ? { url: p.url } : { url: p.url, alt: p.alt })),
    amenities: v.amenities,
    published: v.published,
    settings: v.settings ?? {},
    effectiveSettings,
    createdAt: v.createdAt.toISOString(),
  };
}

/** The venue, if it belongs to this tenant and is in the member's scope; else 404. */
export async function scopedVenue(t: TenantContext, venueId: string) {
  const venue = await tenantRepo(Venue, t, { venueField: '_id' }).findById(venueId);
  if (!venue) throw venueNotFound();
  return venue;
}

/** What a PATCH changed, as before/after snapshots of just those fields. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

const snapshotOf = (v: VenueDoc, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, k === 'location' ? toLatLng(v.location) : structuredClone((v.toObject() as Record<string, unknown>)[k])]));

/** Mounted on ownerRouter. */
export function venuesRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/venues', async (req, res) => {
    const t = tenantOf(req);
    const [venues, owner] = await Promise.all([
      tenantRepo(Venue, t, { venueField: '_id' }).find().sort({ createdAt: -1, _id: -1 }).lean(),
      ownerSettings(t.ownerId),
    ]);
    res.json({
      venues: venues.map((v) => venueJson(v, resolveSettings(owner, (v.settings ?? {}) as VenueSettingsOverride))),
    });
  });

  router.post('/venues', requirePermission('venue.manage'), async (req, res) => {
    const t = tenantOf(req);
    // A venue-limited member could not see the venue they create.
    if (t.venueIds !== 'all') {
      throw new AppError(403, 'forbidden', 'You do not have permission to do this');
    }
    const input = createSchema.parse(req.body);
    const owner = await Owner.findById(t.ownerId, { defaultCurrency: 1 }).lean();
    const base = input.slug ?? slugify(input.name);
    const doc = {
      ownerId: t.ownerId,
      name: input.name,
      address: input.address,
      city: input.city,
      country: input.country,
      timezone: input.timezone,
      currency: input.currency ?? owner!.defaultCurrency,
      location: { type: 'Point', coordinates: [input.location.lng, input.location.lat] },
      photos: input.photos ?? [],
      amenities: input.amenities ?? [],
      settings: applyPatch({}, input.settings ?? {}),
    };
    const attempts = input.slug !== undefined ? 1 : MAX_SLUG_SUFFIX;
    for (let n = 1; n <= attempts; n++) {
      const suffix = n === 1 ? '' : `-${n}`;
      const slug = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
      try {
        const venue = await runInTransaction(async (session) => {
          const [created] = await Venue.create([{ ...doc, slug }], { session });
          await logActivity(
            t,
            {
              action: 'venue.create',
              entity: 'venue',
              entityId: created!.id as string,
              venueId: created!.id as string,
              after: { name: created!.name, slug, country: created!.country, currency: created!.currency },
            },
            services.now(),
            session,
          );
          return created!;
        });
        res.status(201).json({ venue: venueJson(venue, await effectiveForVenue(t.ownerId, venue)) });
        return;
      } catch (err) {
        if (!isSlugDuplicate(err)) throw err;
      }
    }
    throw slugTaken();
  });

  router.get('/venues/:venueId', async (req, res) => {
    const t = tenantOf(req);
    const venue = await scopedVenue(t, req.params.venueId as string);
    res.json({ venue: venueJson(venue, await effectiveForVenue(t.ownerId, venue)) });
  });

  router.patch('/venues/:venueId', requirePermission('venue.manage'), async (req, res) => {
    const t = tenantOf(req);
    const input = patchSchema.parse(req.body);
    const venue = await scopedVenue(t, req.params.venueId as string);
    const keys = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
    const beforeAll = snapshotOf(venue, keys);

    const { location, settings, ...plain } = input;
    for (const [k, v] of Object.entries(plain)) if (v !== undefined) venue.set(k, v);
    if (location) venue.set('location', { type: 'Point', coordinates: [location.lng, location.lat] });
    if (settings) {
      venue.set('settings', applyPatch(venue.settings ?? {}, settings));
      venue.markModified('settings');
    }
    const { before, after } = changedFields(beforeAll, snapshotOf(venue, keys));
    const changed = Object.keys(after);
    const action =
      changed.length === 1 && changed[0] === 'published'
        ? venue.published ? 'venue.publish' : 'venue.unpublish'
        : 'venue.update';
    const publishing = changed.includes('published') && venue.published;
    try {
      await runInTransaction(async (session) => {
        if (publishing) {
          await lockVenue(t, venue.id as string, services.now(), session);
          if ((await activeTurfCount(t, venue.id as string, session)) === 0) {
            throw new AppError(409, 'venue_not_ready', 'Add an active turf before publishing');
          }
        }
        await venue.save({ session });
        await logActivity(
          t,
          { action, entity: 'venue', entityId: venue.id as string, venueId: venue.id as string, before, after },
          services.now(),
          session,
        );
      });
    } catch (err) {
      if (isSlugDuplicate(err)) throw slugTaken();
      throw err;
    }
    res.json({ venue: venueJson(venue, await effectiveForVenue(t.ownerId, venue)) });
  });

  router.delete('/venues/:venueId', requirePermission('venue.manage'), async (req, res) => {
    const t = tenantOf(req);
    const venue = await scopedVenue(t, req.params.venueId as string);
    await runInTransaction(async (session) => {
      if (await Turf.exists({ ownerId: t.ownerId, venueId: venue._id }).session(session)) {
        throw new AppError(409, 'venue_has_turfs', 'Delete or move the turfs first');
      }
      await Venue.deleteOne({ ownerId: t.ownerId, _id: venue._id }, { session });
      await Membership.updateMany(
        { ownerId: t.ownerId, venueIds: venue._id },
        { $pull: { venueIds: venue._id } },
        { session },
      );
      await logActivity(
        t,
        {
          action: 'venue.delete',
          entity: 'venue',
          entityId: venue.id as string,
          venueId: venue.id as string,
          before: { name: venue.name, slug: venue.slug },
        },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
