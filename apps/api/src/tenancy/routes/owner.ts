import { Router } from 'express';
import type { AuthDeps } from '../../auth/deps';
import { requireAuth } from '../../auth/requireAuth';
import { requireTenant, tenantOf } from '../context';
import { Owner } from '../owner.model';
import { Role } from '../role.model';
import { activityRouter } from './activity';

/** Everything under /owners/:ownerId; later plans mount their routers on the returned router. */
export function ownerRouter({ config, services }: AuthDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(config, services), requireTenant());

  router.get('/', async (req, res) => {
    const t = tenantOf(req);
    const [owner, role] = await Promise.all([
      Owner.findById(t.ownerId).lean(),
      Role.findOne({ _id: t.roleId, ownerId: { $in: [null, t.ownerId] } }).lean(),
    ]);
    res.json({
      owner: {
        id: t.ownerId,
        name: owner!.name,
        country: owner!.country,
        defaultCurrency: owner!.defaultCurrency,
        defaultLocale: owner!.defaultLocale,
        status: owner!.status,
      },
      membership: {
        id: t.membershipId,
        role: { id: t.roleId, key: t.roleKey, name: role!.name },
        permissions: [...t.permissions].sort(),
        venueIds: t.venueIds,
      },
    });
  });

  router.use(activityRouter());

  return router;
}
