import { Router } from 'express';
import { AppError } from '../../errors';
import { runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf, type TenantContext } from '../../tenancy/context';
import { lockTurf, lockVenue, scopedTurf } from '../../venues/guards';
import { scopedVenue } from '../../venues/routes/venues';
import { AddonAssignment, assignmentJson } from '../assignment.model';
import { Addon } from '../addon.model';
import { lockAddon, scopedAddon } from '../guards';
import { offeredAddons, offeredJson } from '../offered';
import { turfAssignmentSchema, venueAssignmentSchema } from '../schemas';

const assignmentNotFound = () => new AppError(404, 'not_found', 'Assignment not found');

type Target = { venueId: string; turfId: string | null; currency: string };

/** Mounted on ownerRouter. */
export function assignmentsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  async function target(t: TenantContext, venueId: string, turfId: string | undefined): Promise<Target> {
    if (turfId === undefined) {
      const venue = await scopedVenue(t, venueId);
      return { venueId: venue.id as string, turfId: null, currency: venue.currency };
    }
    const { venue, turf } = await scopedTurf(t, venueId, turfId);
    return { venueId: venue.id as string, turfId: turf.id as string, currency: venue.currency };
  }

  async function put(
    t: TenantContext,
    addonId: string,
    tg: Target,
    input: { enabled: boolean; priceOverride?: number | null; stock?: number | null },
  ) {
    await scopedAddon(t, addonId);
    const priceOverride = input.priceOverride ?? null;
    const stock = input.stock ?? null;
    return runInTransaction(async (session) => {
      const now = services.now();
      await lockAddon(t, addonId, now, session);
      if (tg.turfId !== null) await lockTurf(t, tg.turfId, now, session);
      else await lockVenue(t, tg.venueId, now, session);
      const addon = (await Addon.findOne({ ownerId: t.ownerId, _id: addonId }).session(session))!;
      if (addon.autoApply && stock !== null) {
        throw new AppError(400, 'validation_error', 'Auto-apply add-ons have unlimited stock');
      }
      if (input.enabled) {
        const venueLevel =
          tg.turfId === null
            ? null
            : await AddonAssignment.findOne({ ownerId: t.ownerId, addonId, venueId: tg.venueId, turfId: null }).session(session);
        const price = priceOverride ?? venueLevel?.priceOverride ?? (addon.currency === tg.currency ? addon.price : null);
        if (price === null) {
          throw new AppError(400, 'price_override_required', `Set a price in ${tg.currency} for this venue`);
        }
      }
      const key = { ownerId: t.ownerId, addonId, venueId: tg.venueId, turfId: tg.turfId };
      const prev = await AddonAssignment.findOne(key).session(session);
      const saved = (await AddonAssignment.findOneAndUpdate(
        key,
        { $set: { enabled: input.enabled, priceOverride, stock } },
        { upsert: true, new: true, session },
      ))!;
      const before = prev ? assignmentJson(prev) : null;
      const after = assignmentJson(saved);
      await logActivity(
        t,
        { action: 'addon.assign', entity: 'addon', entityId: addonId, venueId: tg.venueId, before, after },
        now,
        session,
      );
      return after;
    });
  }

  async function remove(t: TenantContext, addonId: string, tg: Target) {
    await scopedAddon(t, addonId);
    await runInTransaction(async (session) => {
      const now = services.now();
      await lockAddon(t, addonId, now, session);
      const removed = await AddonAssignment.findOneAndDelete(
        { ownerId: t.ownerId, addonId, venueId: tg.venueId, turfId: tg.turfId },
        { session },
      );
      if (!removed) throw assignmentNotFound();
      await logActivity(
        t,
        { action: 'addon.unassign', entity: 'addon', entityId: addonId, venueId: tg.venueId, before: assignmentJson(removed) },
        now,
        session,
      );
    });
  }

  const manage = requirePermission('addon.manage');
  const venuePath = '/venues/:venueId/addons/:addonId';
  const turfPath = '/venues/:venueId/turfs/:turfId/addons/:addonId';

  router.put(venuePath, manage, async (req, res) => {
    const t = tenantOf(req);
    const input = venueAssignmentSchema.parse(req.body);
    const tg = await target(t, req.params.venueId as string, undefined);
    res.json({ assignment: await put(t, req.params.addonId as string, tg, input) });
  });

  router.put(turfPath, manage, async (req, res) => {
    const t = tenantOf(req);
    const input = turfAssignmentSchema.parse(req.body);
    const tg = await target(t, req.params.venueId as string, req.params.turfId as string);
    res.json({ assignment: await put(t, req.params.addonId as string, tg, input) });
  });

  router.delete(venuePath, manage, async (req, res) => {
    const t = tenantOf(req);
    await remove(t, req.params.addonId as string, await target(t, req.params.venueId as string, undefined));
    res.status(204).end();
  });

  router.delete(turfPath, manage, async (req, res) => {
    const t = tenantOf(req);
    await remove(
      t,
      req.params.addonId as string,
      await target(t, req.params.venueId as string, req.params.turfId as string),
    );
    res.status(204).end();
  });

  router.get('/venues/:venueId/addons', manage, async (req, res) => {
    const t = tenantOf(req);
    const venue = await scopedVenue(t, req.params.venueId as string);
    const assignments = await AddonAssignment.find({ ownerId: t.ownerId, venueId: venue._id }).sort({ _id: 1 });
    res.json({ assignments: assignments.map(assignmentJson) });
  });

  router.get('/venues/:venueId/turfs/:turfId/addons', async (req, res) => {
    const t = tenantOf(req);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const addons = await offeredAddons(t.ownerId, venue, turf);
    res.json({ currency: venue.currency, addons: addons.map(offeredJson) });
  });

  return router;
}
