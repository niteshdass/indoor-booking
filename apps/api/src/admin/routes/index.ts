import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ADMIN_ACTIVITY_PAGE_SIZE, type AdminMeJson, type PlatformLogPageJson } from '@booking/shared';
import type { AuthDeps } from '../../auth/deps';
import { requireAuth } from '../../auth/requireAuth';
import { platformOf, requirePlatform } from '../context';
import { platformLogJson } from '../logJson';
import { PlatformLog } from '../platformLog.model';
import { adminOwnersRouter } from './owners';
import { adminReviewsRouter } from './reviews';
import { adminSettingsRouter } from './settings';
import { adminUsersRouter } from './users';

const activityQuery = z
  .object({ before: z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id') })
  .partial()
  .strict();

/** The platform admin API, mounted at /admin. Every route needs a platform role. */
export function adminRouter({ config, services }: AuthDeps): Router {
  const router = Router();
  router.use(requireAuth(config, services), requirePlatform());

  router.get('/me', requirePlatform('platform.view'), (req, res) => {
    const p = platformOf(req);
    const body: AdminMeJson = { role: { key: p.roleKey, name: p.roleName }, permissions: [...p.permissions].sort() };
    res.json(body);
  });

  router.get('/activity', requirePlatform('platform.view'), async (req, res) => {
    const q = activityQuery.parse(req.query);
    const filter = q.before ? { _id: { $lt: new mongoose.Types.ObjectId(q.before) } } : {};
    const rows = await PlatformLog.find(filter)
      .sort({ _id: -1 })
      .limit(ADMIN_ACTIVITY_PAGE_SIZE + 1)
      .lean();
    const page = rows.slice(0, ADMIN_ACTIVITY_PAGE_SIZE);
    const body: PlatformLogPageJson = {
      entries: await platformLogJson(page),
      nextBefore: rows.length > ADMIN_ACTIVITY_PAGE_SIZE ? String(page[page.length - 1]!._id) : null,
    };
    res.json(body);
  });

  router.use(adminOwnersRouter(services));
  router.use(adminUsersRouter(services));
  router.use(adminReviewsRouter(services));
  router.use(adminSettingsRouter(config, services));

  return router;
}
