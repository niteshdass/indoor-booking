import { Router } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { runInTransaction } from '../../db';
import { logActivity } from '../../tenancy/activityLog.model';
import { assertVenueAccess, permissionsCover, tenantOf, type TenantContext } from '../../tenancy/context';
import { scopedTurf } from '../../venues/guards';
import { scopedVenue } from '../../venues/routes/venues';
import { Closure, closureJson } from '../closure.model';
import { closureSchema } from '../schemas';

const forbidden = () => new AppError(403, 'forbidden', 'You do not have permission to do this');
const closureNotFound = () => new AppError(404, 'not_found', 'Closure not found');

/** Owner-level closures need settings.edit on all venues; venue and turf ones need slot.override in scope. */
function assertCanClose(t: TenantContext, venueId: string | null): void {
  if (venueId === null) {
    if (!permissionsCover(t, ['settings.edit']) || t.venueIds !== 'all') throw forbidden();
  } else {
    if (!permissionsCover(t, ['slot.override'])) throw forbidden();
    assertVenueAccess(t, venueId);
  }
}

/** Mounted on ownerRouter. */
export function closuresRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/closures', async (req, res) => {
    const t = tenantOf(req);
    const { venueId, turfId } = req.query;
    const filter: Record<string, unknown> = { ownerId: t.ownerId };
    if (venueId !== undefined) {
      if (typeof venueId !== 'string') throw new AppError(400, 'validation_error', 'Invalid venueId');
      filter.venueId = { $in: [null, (await scopedVenue(t, venueId)).id] };
    } else if (t.venueIds !== 'all') {
      filter.venueId = { $in: [null, ...t.venueIds] };
    }
    if (turfId !== undefined) {
      if (typeof turfId !== 'string' || !mongoose.isValidObjectId(turfId)) {
        throw new AppError(400, 'validation_error', 'Invalid turfId');
      }
      filter.turfId = { $in: [null, turfId] };
    }
    const closures = await Closure.find(filter).sort({ from: 1, _id: 1 });
    res.json({ closures: closures.map(closureJson) });
  });

  router.post('/closures', async (req, res) => {
    const t = tenantOf(req);
    const input = closureSchema.parse(req.body);
    const venueId = input.venueId ?? null;
    assertCanClose(t, venueId);
    let venueOid: string | null = null;
    let turfOid: string | null = null;
    if (venueId !== null && input.turfId) {
      const { venue, turf } = await scopedTurf(t, venueId, input.turfId);
      venueOid = venue.id as string;
      turfOid = turf.id as string;
    } else if (venueId !== null) {
      venueOid = (await scopedVenue(t, venueId)).id as string;
    }
    const closure = await runInTransaction(async (session) => {
      const [created] = await Closure.create(
        [{ ownerId: t.ownerId, venueId: venueOid, turfId: turfOid, from: input.from, to: input.to, reason: input.reason || null }],
        { session },
      );
      await logActivity(
        t,
        {
          action: 'closure.create',
          entity: 'closure',
          entityId: created!.id as string,
          ...(venueOid ? { venueId: venueOid } : {}),
          after: closureJson(created!),
        },
        services.now(),
        session,
      );
      return created!;
    });
    res.status(201).json({ closure: closureJson(closure) });
  });

  router.delete('/closures/:closureId', async (req, res) => {
    const t = tenantOf(req);
    const id = req.params.closureId as string;
    const closure = mongoose.isValidObjectId(id) ? await Closure.findOne({ ownerId: t.ownerId, _id: id }) : null;
    if (!closure) throw closureNotFound();
    assertCanClose(t, closure.venueId ? String(closure.venueId) : null);
    await runInTransaction(async (session) => {
      await Closure.deleteOne({ ownerId: t.ownerId, _id: closure._id }, { session });
      await logActivity(
        t,
        {
          action: 'closure.delete',
          entity: 'closure',
          entityId: closure.id as string,
          ...(closure.venueId ? { venueId: String(closure.venueId) } : {}),
          before: closureJson(closure),
        },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
