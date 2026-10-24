import { Router } from 'express';
import { z } from 'zod';
import { SPORTS, resolveSettings, type EffectiveSettings, type TurfSettingsOverride, type VenueSettingsOverride } from '@booking/shared';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { applyPatch, turfSettingsPatchSchema } from '../settingsSchema';
import { effectiveForTurf, ownerSettings } from '../effective';
import { Turf, type TurfDoc } from '../turf.model';
import { Venue } from '../venue.model';
import { activeTurfCount, lockVenue, scopedTurf } from '../guards';
import { changedFields, scopedVenue } from './venues';

const fields = {
  name: z.string().trim().min(1).max(60),
  sports: z.array(z.enum(SPORTS)).min(1).transform((s) => [...new Set(s)]),
  indoor: z.boolean(),
  settings: turfSettingsPatchSchema,
};
const createSchema = z
  .object({
    ...fields,
    slotLengthMin: z.number().int().min(30).max(240).multipleOf(15),
    settings: fields.settings.optional(),
  })
  .strict();
const patchSchema = z
  .object({
    name: fields.name.optional(),
    sports: fields.sports.optional(),
    indoor: fields.indoor.optional(),
    active: z.boolean().optional(),
    settings: fields.settings.optional(),
  })
  .strict();

const nameTaken = () => new AppError(409, 'turf_name_taken', 'This venue already has a turf with that name');
const lastActive = () =>
  new AppError(409, 'last_active_turf', 'A published venue needs at least one active turf; unpublish it first');

const isNameDuplicate = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'name');

type TurfLike = Pick<TurfDoc, 'venueId' | 'name' | 'sports' | 'indoor' | 'slotLengthMin' | 'active' | 'settings' | 'pricing'> & {
  _id: unknown;
  createdAt: Date;
};

function turfJson(turf: TurfLike, effectiveSettings: EffectiveSettings) {
  return {
    id: String(turf._id),
    venueId: String(turf.venueId),
    name: turf.name,
    sports: turf.sports,
    indoor: turf.indoor,
    slotLengthMin: turf.slotLengthMin,
    active: turf.active,
    settings: turf.settings ?? {},
    pricing: turf.pricing ?? null,
    effectiveSettings,
    createdAt: turf.createdAt.toISOString(),
  };
}

const snapshot = (turf: TurfDoc) => ({
  name: turf.name,
  sports: [...turf.sports],
  indoor: turf.indoor,
  active: turf.active,
  settings: structuredClone(turf.settings ?? {}),
});

/** Mounted on ownerRouter; every route sits under a venue the member can see. */
export function turfsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  const base = '/venues/:venueId/turfs';

  router.get(base, async (req, res) => {
    const t = tenantOf(req);
    const venue = await scopedVenue(t, req.params.venueId as string);
    const [list, owner] = await Promise.all([
      Turf.find({ ownerId: t.ownerId, venueId: venue._id })
        .sort({ name: 1 })
        .collation({ locale: 'en', strength: 2 })
        .lean(),
      ownerSettings(t.ownerId),
    ]);
    const venueSettings = (venue.settings ?? {}) as VenueSettingsOverride;
    res.json({
      turfs: list.map((turf) =>
        turfJson(turf, resolveSettings(owner, venueSettings, (turf.settings ?? {}) as TurfSettingsOverride)),
      ),
    });
  });

  router.post(base, requirePermission('turf.manage'), async (req, res) => {
    const t = tenantOf(req);
    const input = createSchema.parse(req.body);
    const venue = await scopedVenue(t, req.params.venueId as string);
    const venueId = venue.id as string;
    try {
      const turf = await runInTransaction(async (session) => {
        await lockVenue(t, venueId, services.now(), session);
        const [created] = await Turf.create(
          [
            {
              ownerId: t.ownerId,
              venueId,
              name: input.name,
              sports: input.sports,
              indoor: input.indoor,
              slotLengthMin: input.slotLengthMin,
              settings: applyPatch({}, input.settings ?? {}),
            },
          ],
          { session },
        );
        await logActivity(
          t,
          { action: 'turf.create', entity: 'turf', entityId: created!.id as string, venueId, after: snapshot(created!) },
          services.now(),
          session,
        );
        return created!;
      });
      res.status(201).json({ turf: turfJson(turf, await effectiveForTurf(t.ownerId, venue, turf)) });
    } catch (err) {
      if (isNameDuplicate(err)) throw nameTaken();
      throw err;
    }
  });

  router.get(`${base}/:turfId`, async (req, res) => {
    const t = tenantOf(req);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    res.json({ turf: turfJson(turf, await effectiveForTurf(t.ownerId, venue, turf)) });
  });

  router.patch(`${base}/:turfId`, requirePermission('turf.manage'), async (req, res) => {
    const t = tenantOf(req);
    const input = patchSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const venueId = venue.id as string;
    const beforeAll = snapshot(turf);
    const wasActive = turf.active;

    const { settings, ...plain } = input;
    for (const [k, v] of Object.entries(plain)) if (v !== undefined) turf.set(k, v);
    if (settings) {
      turf.set('settings', applyPatch(turf.settings ?? {}, settings));
      turf.markModified('settings');
    }
    const { before, after } = changedFields(beforeAll, snapshot(turf));
    try {
      await runInTransaction(async (session) => {
        if (wasActive && turf.active === false) {
          await lockVenue(t, venueId, services.now(), session);
          const current = await Venue.findOne({ ownerId: t.ownerId, _id: venueId }, { published: 1 }).session(session);
          if (current?.published && (await activeTurfCount(t, venueId, session, turf._id)) === 0) throw lastActive();
        }
        await turf.save({ session });
        await logActivity(
          t,
          { action: 'turf.update', entity: 'turf', entityId: turf.id as string, venueId, before, after },
          services.now(),
          session,
        );
      });
    } catch (err) {
      if (isNameDuplicate(err)) throw nameTaken();
      throw err;
    }
    res.json({ turf: turfJson(turf, await effectiveForTurf(t.ownerId, venue, turf)) });
  });

  // Hard delete for now; Plan 07 must refuse it once the turf has bookings.
  router.delete(`${base}/:turfId`, requirePermission('turf.manage'), async (req, res) => {
    const t = tenantOf(req);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const venueId = venue.id as string;
    await runInTransaction(async (session) => {
      await lockVenue(t, venueId, services.now(), session);
      if (turf.active) {
        const current = await Venue.findOne({ ownerId: t.ownerId, _id: venueId }, { published: 1 }).session(session);
        if (current?.published && (await activeTurfCount(t, venueId, session, turf._id)) === 0) throw lastActive();
      }
      await Turf.deleteOne({ ownerId: t.ownerId, _id: turf._id }, { session });
      await logActivity(
        t,
        { action: 'turf.delete', entity: 'turf', entityId: turf.id as string, venueId, before: snapshot(turf) },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
