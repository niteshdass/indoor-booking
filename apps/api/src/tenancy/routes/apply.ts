import { Router } from 'express';
import { z } from 'zod';
import { LOCALES } from '@booking/shared';
import { resolveGeneral } from '../../admin/settings';
import { logPlatform } from '../../admin/platformLog.model';
import type { AuthDeps } from '../../auth/deps';
import { requireAuth } from '../../auth/requireAuth';
import { AppError } from '../../errors';
import { createOwner } from '../createOwner';
import { Membership } from '../membership.model';
import { Owner } from '../owner.model';
import { systemRole } from '../role.model';

const applySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    country: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();

/** Owner self-registration: any signed-in user applies; the owner waits in pending_approval for a platform admin. */
export function applyOwnerRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  router.post('/owners', requireAuth(config, services), async (req, res) => {
    const input = applySchema.parse(req.body ?? {});
    const userId = req.auth!.userId;
    const role = await systemRole('owner');
    // Cross-owner by design: the applicant's own owner memberships.
    const ownerIds = await Membership.distinct('ownerId', { userId, roleId: role._id, status: 'active' }).setOptions({
      crossTenant: true,
    });
    if (await Owner.exists({ _id: { $in: ownerIds }, status: 'pending_approval' })) {
      throw new AppError(409, 'application_pending', 'You already have an application waiting for approval');
    }
    const now = services.now();
    const automatic = (await resolveGeneral(config)).ownerApproval === 'automatic';
    const { owner } = await createOwner({ userId, ...input, status: automatic ? 'active' : 'pending_approval' }, now);
    const ownerId = owner.id as string;
    await logPlatform(userId, { action: 'owner.applied', entity: 'owner', entityId: ownerId, ownerId }, now);
    if (automatic) await logPlatform(userId, { action: 'owner.auto_approved', entity: 'owner', entityId: ownerId, ownerId }, now);
    res.status(201).json({ owner: { id: ownerId, name: owner.name, status: owner.status } });
  });

  return router;
}
