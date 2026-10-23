import { Router } from 'express';
import { isPermission } from '@booking/shared';
import type { AuthDeps } from '../../auth/deps';
import { requireAuth } from '../../auth/requireAuth';
import { Membership } from '../membership.model';
import { Owner } from '../owner.model';
import { Role } from '../role.model';

export function myMembershipsRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  router.get('/me/memberships', requireAuth(config, services), async (req, res) => {
    // Cross-owner by design: the signed-in user's own memberships.
    const memberships = await Membership.find({ userId: req.auth!.userId, status: 'active' })
      .setOptions({ crossTenant: true })
      .lean();
    const [owners, roles] = await Promise.all([
      Owner.find({ _id: { $in: memberships.map((m) => m.ownerId) } }).lean(),
      Role.find({ _id: { $in: memberships.map((m) => m.roleId) } })
        .setOptions({ crossTenant: true })
        .lean(),
    ]);
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));
    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    const items = memberships.flatMap((m) => {
      const owner = ownerById.get(String(m.ownerId));
      const role = roleById.get(String(m.roleId));
      if (!owner || !role) return [];
      return [
        {
          ownerId: String(owner._id),
          ownerName: owner.name,
          ownerStatus: owner.status,
          role: { id: String(role._id), key: (role.system && role.key) || null, name: role.name },
          permissions: role.permissions.filter(isPermission).sort(),
          venueIds: m.allVenues ? 'all' : m.venueIds.map(String),
        },
      ];
    });
    items.sort((a, b) => a.ownerName.localeCompare(b.ownerName));
    res.json({ memberships: items });
  });

  return router;
}
