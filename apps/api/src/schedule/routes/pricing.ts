import { Router } from 'express';
import type { AppServices } from '../../services';
import { runInTransaction } from '../../db';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { lockTurf, scopedTurf } from '../../venues/guards';
import { Turf } from '../../venues/turf.model';
import { pricingSchema } from '../schemas';

/** Mounted on ownerRouter. */
export function pricingRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.put('/venues/:venueId/turfs/:turfId/pricing', requirePermission('pricing.edit'), async (req, res) => {
    const t = tenantOf(req);
    const pricing = pricingSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const turfId = turf.id as string;
    const before = structuredClone(turf.pricing ?? null);
    await runInTransaction(async (session) => {
      await lockTurf(t, turfId, services.now(), session);
      await Turf.updateOne({ ownerId: t.ownerId, _id: turfId }, { $set: { pricing } }, { session });
      await logActivity(
        t,
        {
          action: 'pricing.update',
          entity: 'turf',
          entityId: turfId,
          venueId: venue.id as string,
          before: { pricing: before },
          after: { pricing },
        },
        services.now(),
        session,
      );
    });
    res.json({ pricing });
  });

  return router;
}
