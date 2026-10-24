import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../auth/user.model';
import { ActivityLog } from '../activityLog.model';
import { requirePermission, tenantOf } from '../context';
import { tenantRepo } from '../repo';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'Must be an activity id')
    .optional(),
});

/** Mounted on ownerRouter. */
export function activityRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/activity', requirePermission('reports.view'), async (req, res) => {
    const { limit, before } = querySchema.parse(req.query);
    const t = tenantOf(req);
    const rows = await tenantRepo(ActivityLog, t, { venueField: 'venueId' })
      .find(before ? { _id: { $lt: before } } : {})
      .sort({ _id: -1 })
      .limit(limit)
      .lean();
    const actors = await User.find({ _id: { $in: rows.flatMap((r) => (r.actorId ? [r.actorId] : [])) } }, { name: 1 }).lean();
    const nameById = new Map(actors.map((u) => [String(u._id), u.name ?? null]));
    const items = rows.map((r) => ({
      id: String(r._id),
      action: r.action,
      entity: r.entity,
      entityId: String(r.entityId),
      venueId: r.venueId ? String(r.venueId) : null,
      actor: r.actorId
        ? { id: String(r.actorId), name: nameById.get(String(r.actorId)) ?? null }
        : null,
      before: r.before ?? null,
      after: r.after ?? null,
      at: r.at.toISOString(),
    }));
    res.json({ items, nextBefore: items.length === limit ? items[items.length - 1]!.id : null });
  });

  return router;
}
