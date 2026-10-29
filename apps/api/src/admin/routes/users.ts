import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ADMIN_PAGE_SIZE, type AdminUsersJson } from '@booking/shared';
import { revokeAllForUser } from '../../auth/tokens';
import { User } from '../../auth/user.model';
import { escapeRegExp } from '../../bookings/customers';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { Membership } from '../../tenancy/membership.model';
import { platformOf, requirePlatform } from '../context';
import { logPlatform } from '../platformLog.model';
import { personJson } from '../stats';

const PHONE_MIN_DIGITS = 4;

const listQuery = z
  .object({
    status: z.enum(['active', 'disabled']),
    q: z.string().trim().max(100),
    page: z.coerce.number().int().min(1).max(10_000),
  })
  .partial()
  .strict();

function searchFilter(q: string): Record<string, unknown> {
  const re = new RegExp(escapeRegExp(q), 'i');
  const digits = q.replace(/\D/g, '');
  return {
    $or: [{ name: re }, { email: re }, ...(digits.length >= PHONE_MIN_DIGITS ? [{ phone: new RegExp(digits) }] : [])],
  };
}

/** Player and staff accounts; mounted on the admin router. */
export function adminUsersRouter(services: AppServices): Router {
  const router = Router();
  router.use('/users', requirePlatform('platform.users'));

  router.get('/users', async (req, res) => {
    const q = listQuery.parse(req.query);
    const page = q.page ?? 1;
    const filter: Record<string, unknown> = q.q ? searchFilter(q.q) : {};
    if (q.status) filter.status = q.status;
    const [rows, total] = await Promise.all([
      User.find(filter, { name: 1, email: 1, phone: 1, status: 1, platformRoleId: 1, createdAt: 1 })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * ADMIN_PAGE_SIZE)
        .limit(ADMIN_PAGE_SIZE)
        .lean(),
      User.countDocuments(filter),
    ]);
    // Cross-owner by design: a user's team count spans every owner.
    const teams = await Membership.aggregate<{ _id: unknown; n: number }>([
      { $match: { userId: { $in: rows.map((u) => u._id) }, status: 'active' } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]).option({ crossTenant: true });
    const teamCount = new Map(teams.map((r) => [String(r._id), r.n]));
    const body: AdminUsersJson = {
      users: rows.map((u) => ({
        ...personJson(u),
        status: u.status as 'active' | 'disabled',
        platformAdmin: u.platformRoleId != null,
        teams: teamCount.get(String(u._id)) ?? 0,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
    };
    res.json(body);
  });

  const setStatus = (path: 'disable' | 'enable', status: 'active' | 'disabled') =>
    router.post(`/users/:id/${path}`, async (req, res) => {
      const id = req.params.id;
      const user = typeof id === 'string' && mongoose.isValidObjectId(id) ? await User.findById(id) : null;
      if (!user) throw new AppError(404, 'not_found', 'User not found');
      const actorId = platformOf(req).userId;
      if (user.id === actorId || user.platformRoleId != null) {
        throw new AppError(409, 'cannot_change_admin', 'Platform admin accounts cannot be changed here');
      }
      if (user.status !== status) {
        const now = services.now();
        user.status = status;
        await user.save();
        if (status === 'disabled') await revokeAllForUser(user.id as string, now);
        await logPlatform(actorId, { action: status === 'disabled' ? 'user.disabled' : 'user.enabled', entity: 'user', entityId: user.id as string }, now);
      }
      res.json({ user: { id: user.id as string, status: user.status } });
    });

  setStatus('disable', 'disabled');
  setStatus('enable', 'active');

  return router;
}
