import { Router } from 'express';
import mongoose from 'mongoose';
import type { OwnerSmsUsageJson } from '@booking/shared';
import { smsMetered } from '../admin/settings';
import type { AppServices } from '../services';
import { Owner } from '../tenancy/owner.model';
import { requirePermission, tenantOf } from '../tenancy/context';
import { Notification } from './notification.model';

/** SMS this owner sent since the start of `now`'s calendar month (UTC). */
export async function smsUsageThisMonth(ownerId: string, now: Date): Promise<{ messages: number; segments: number }> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await Notification.aggregate<{ messages: number; segments: number }>([
    { $match: { ownerId: new mongoose.Types.ObjectId(ownerId), channel: 'sms', status: 'sent', sentAt: { $gte: since } } },
    { $group: { _id: null, messages: { $sum: 1 }, segments: { $sum: { $ifNull: ['$smsSegments', 0] } } } },
  ]);
  return { messages: row?.messages ?? 0, segments: row?.segments ?? 0 };
}

/** The owner's SMS balance and this month's use; mounted on ownerRouter. */
export function ownerSmsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/sms-usage', requirePermission('settings.edit'), async (req, res) => {
    const { ownerId } = tenantOf(req);
    const [metered, owner, thisMonth] = await Promise.all([
      smsMetered(),
      Owner.findById(ownerId, { smsCredits: 1 }).lean(),
      smsUsageThisMonth(ownerId, services.now()),
    ]);
    const body: OwnerSmsUsageJson = { metered, credits: owner?.smsCredits ?? 0, thisMonth };
    res.json(body);
  });

  return router;
}
