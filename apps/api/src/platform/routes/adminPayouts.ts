import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ADMIN_PAGE_SIZE, SUSPEND_REASON_MAX, type AdminPayoutsJson } from '@booking/shared';
import { platformOf, requirePlatform } from '../../admin/context';
import { logPlatform } from '../../admin/platformLog.model';
import { runInTransaction } from '../../db';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { Owner } from '../../tenancy/owner.model';
import { PlatformPayout, payoutJson, type PlatformPayoutDoc } from '../payout.model';

const listQuery = z
  .object({ status: z.enum(['pending', 'all']), before: z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id') })
  .partial()
  .strict();
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(SUSPEND_REASON_MAX) });

const notPending = () => new AppError(409, 'payout_not_pending', 'This payout was already reviewed');

async function withOwnerNames(rows: PlatformPayoutDoc[]) {
  const owners = await Owner.find({ _id: { $in: rows.map((r) => r.ownerId) } }, { name: 1 }).lean();
  const names = new Map(owners.map((o) => [String(o._id), o.name]));
  return rows.map((r) => payoutJson(r, names.get(String(r.ownerId)) ?? ''));
}

/** The platform's queue of owner payouts to check; mounted on the admin router. */
export function adminPayoutsRouter(services: AppServices): Router {
  const router = Router();
  router.use('/payouts', requirePlatform('platform.owners'));

  router.get('/payouts', async (req, res) => {
    const q = listQuery.parse(req.query);
    const filter: Record<string, unknown> = (q.status ?? 'pending') === 'pending' ? { status: 'pending' } : {};
    if (q.before) filter._id = { $lt: new mongoose.Types.ObjectId(q.before) };
    // Cross-owner by design: the queue spans every owner.
    const rows = await PlatformPayout.find(filter)
      .sort({ _id: -1 })
      .limit(ADMIN_PAGE_SIZE + 1)
      .setOptions({ crossTenant: true });
    const page = rows.slice(0, ADMIN_PAGE_SIZE);
    const body: AdminPayoutsJson = {
      payouts: await withOwnerNames(page),
      nextBefore: rows.length > ADMIN_PAGE_SIZE ? String(page[page.length - 1]!._id) : null,
    };
    res.json(body);
  });

  /** Confirm the money arrived, or reject the payout with a reason; both only while it is pending. */
  const review = (path: 'confirm' | 'reject') =>
    router.post(`/payouts/:id/${path}`, async (req, res) => {
      const id = req.params.id;
      if (typeof id !== 'string' || !mongoose.isValidObjectId(id)) throw new AppError(404, 'not_found', 'Payout not found');
      const reason = path === 'reject' ? rejectSchema.parse(req.body ?? {}).reason : null;
      const actorId = platformOf(req).userId;
      const now = services.now();
      const payout = await runInTransaction(async (session) => {
        const found = await PlatformPayout.findById(id).setOptions({ crossTenant: true }).session(session);
        if (!found) throw new AppError(404, 'not_found', 'Payout not found');
        if (found.status !== 'pending') throw notPending();
        const ownerId = String(found.ownerId);
        const set =
          path === 'confirm'
            ? { status: 'confirmed', reviewedAt: now, reviewedBy: actorId }
            : { status: 'rejected', rejectReason: reason, reviewedAt: now, reviewedBy: actorId };
        // Conditional on still pending, so two admins cannot both review it.
        const updated = await PlatformPayout.findOneAndUpdate({ _id: found._id, ownerId, status: 'pending' }, { $set: set }, { new: true, session });
        if (!updated) throw notPending();
        await logPlatform(
          actorId,
          { action: path === 'confirm' ? 'payout.confirmed' : 'payout.rejected', entity: 'owner', entityId: ownerId, ownerId, reason },
          now,
          session,
        );
        return updated;
      });
      const [json] = await withOwnerNames([payout]);
      res.json({ payout: json });
    });

  review('confirm');
  review('reject');

  return router;
}
