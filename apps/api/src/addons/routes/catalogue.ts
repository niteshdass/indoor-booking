import { Router } from 'express';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { Owner } from '../../tenancy/owner.model';
import { Addon, addonJson } from '../addon.model';
import { AddonAssignment } from '../assignment.model';
import { assertCatalogueWriter, lockAddon, scopedAddon } from '../guards';
import { addonCreateSchema, addonMergedSchema, addonPatchSchema } from '../schemas';

const nameTaken = () => new AppError(409, 'addon_name_taken', 'An add-on with this name already exists');
const isNameDuplicate = (err: unknown) =>
  isDuplicateKeyError(err) && Object.hasOwn((err as { keyPattern?: object }).keyPattern ?? {}, 'name');

/** Mounted on ownerRouter. */
export function catalogueRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/addons', requirePermission('addon.manage'), async (req, res) => {
    const t = tenantOf(req);
    const addons = await Addon.find({ ownerId: t.ownerId })
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1, _id: 1 });
    res.json({ addons: addons.map(addonJson) });
  });

  router.post('/addons', async (req, res) => {
    const t = tenantOf(req);
    assertCatalogueWriter(t);
    const input = addonCreateSchema.parse(req.body);
    const owner = (await Owner.findById(t.ownerId, { defaultCurrency: 1 }).lean())!;
    try {
      const addon = await runInTransaction(async (session) => {
        const [created] = await Addon.create([{ ...input, ownerId: t.ownerId, currency: owner.defaultCurrency }], { session });
        await logActivity(
          t,
          { action: 'addon.create', entity: 'addon', entityId: created!.id as string, after: addonJson(created!) },
          services.now(),
          session,
        );
        return created!;
      });
      res.status(201).json({ addon: addonJson(addon) });
    } catch (err) {
      if (isNameDuplicate(err)) throw nameTaken();
      throw err;
    }
  });

  router.patch('/addons/:addonId', async (req, res) => {
    const t = tenantOf(req);
    assertCatalogueWriter(t);
    const addonId = req.params.addonId as string;
    const patch = addonPatchSchema.parse(req.body);
    await scopedAddon(t, addonId);
    try {
      const addon = await runInTransaction(async (session) => {
        const now = services.now();
        await lockAddon(t, addonId, now, session);
        const current = (await Addon.findOne({ ownerId: t.ownerId, _id: addonId }).session(session))!;
        addonMergedSchema.parse({
          pricingType: patch.pricingType ?? current.pricingType,
          stock: patch.stock !== undefined ? patch.stock : current.stock ?? null,
          autoApply: patch.autoApply !== undefined ? patch.autoApply : current.autoApply ?? null,
        });
        const before = addonJson(current) as Record<string, unknown>;
        current.set(patch);
        await current.save({ session });
        const after = addonJson(current) as Record<string, unknown>;
        const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (changed.length > 0) {
          await logActivity(
            t,
            {
              action: 'addon.update',
              entity: 'addon',
              entityId: current.id as string,
              before: Object.fromEntries(changed.map((k) => [k, before[k]])),
              after: Object.fromEntries(changed.map((k) => [k, after[k]])),
            },
            now,
            session,
          );
        }
        return current;
      });
      res.json({ addon: addonJson(addon) });
    } catch (err) {
      if (isNameDuplicate(err)) throw nameTaken();
      throw err;
    }
  });

  router.delete('/addons/:addonId', async (req, res) => {
    const t = tenantOf(req);
    assertCatalogueWriter(t);
    const addonId = (await scopedAddon(t, req.params.addonId as string)).id as string;
    await runInTransaction(async (session) => {
      const at = services.now();
      await lockAddon(t, addonId, at, session);
      const current = (await Addon.findOne({ ownerId: t.ownerId, _id: addonId }).session(session))!;
      await Addon.deleteOne({ ownerId: t.ownerId, _id: addonId }, { session });
      await AddonAssignment.deleteMany({ ownerId: t.ownerId, addonId }, { session });
      await logActivity(
        t,
        { action: 'addon.delete', entity: 'addon', entityId: addonId, before: addonJson(current) },
        at,
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
