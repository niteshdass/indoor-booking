import { Router } from 'express';
import { withOwnerDefaults, type OwnerSettings } from '@booking/shared';
import { runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { Owner } from '../../tenancy/owner.model';
import { applyPatch, assertCanPay, ownerSettingsPatchSchema } from '../settingsSchema';

/** Owner-wide settings; mounted on ownerRouter. Stores only the keys the owner set. */
export function settingsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/settings', async (req, res) => {
    const owner = await Owner.findById(tenantOf(req).ownerId, { settings: 1 }).lean();
    res.json({ settings: withOwnerDefaults((owner!.settings ?? {}) as Partial<OwnerSettings>) });
  });

  router.patch('/settings', requirePermission('settings.edit'), async (req, res) => {
    const t = tenantOf(req);
    const patch = ownerSettingsPatchSchema.parse(req.body);
    const owner = (await Owner.findById(t.ownerId))!;
    const before = (owner.settings ?? {}) as Partial<OwnerSettings>;
    const after = applyPatch(before, patch);
    if (patch.paymentPolicy !== undefined || patch.paymentMethods !== undefined) assertCanPay(withOwnerDefaults(after));
    owner.set('settings', after);
    owner.markModified('settings');
    await runInTransaction(async (session) => {
      await owner.save({ session });
      await logActivity(
        t,
        { action: 'settings.update', entity: 'owner', entityId: t.ownerId, before, after },
        services.now(),
        session,
      );
    });
    res.json({ settings: withOwnerDefaults(after) });
  });

  return router;
}
