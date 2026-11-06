import { Router } from 'express';
import { z } from 'zod';
import { LOCALES, type SetupResult } from '@booking/shared';
import { resolveGeneral } from '../admin/settings';
import { logPlatform } from '../admin/platformLog.model';
import type { AuthDeps } from '../auth/deps';
import { requireAuth } from '../auth/requireAuth';
import { runInTransaction } from '../db';
import { AppError } from '../errors';
import type { AppServices } from '../services';
import { createOwnerIn } from '../tenancy/createOwner';
import { requirePermission, tenantOf } from '../tenancy/context';
import { Membership } from '../tenancy/membership.model';
import { Owner } from '../tenancy/owner.model';
import { systemRole } from '../tenancy/role.model';
import { expandMapLink } from '../venues/routes/mapLink';
import { checkSetup, venueSetupSchema, withFreeSlug, writeSetup } from './setup';

const businessSetupSchema = venueSetupSchema.extend({
  business: z
    .object({
      name: z.string().trim().min(1).max(100),
      country: z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
      currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
      locale: z.enum(LOCALES).optional(),
    })
    .strict(),
});

/**
 * The easy setup for someone new: the business and its first venue in one go. Like `POST /owners` the business
 * waits for approval unless the platform approves automatically; until then its venue stays hidden.
 */
export function onboardingRouter({ config, services }: AuthDeps): Router {
  const router = Router();
  const mapLinkBody = z.object({ url: z.string().trim().max(2000) }).strict();

  router.post('/onboarding', requireAuth(config, services), async (req, res) => {
    const input = businessSetupSchema.parse(req.body ?? {});
    await checkSetup(input);
    const userId = req.auth!.userId;
    const role = await systemRole('owner');
    // Cross-owner by design: the applicant's own owner memberships.
    const ownerIds = await Membership.distinct('ownerId', { userId, roleId: role._id, status: 'active' }).setOptions({
      crossTenant: true,
    });
    if (await Owner.exists({ _id: { $in: ownerIds }, status: 'pending_approval' })) {
      throw new AppError(409, 'application_pending', 'You already have an application waiting for approval');
    }
    // A suspended (or rejected) business does not get a fresh one, which automatic approval would
    // make live at once.
    if (await Owner.exists({ _id: { $in: ownerIds }, status: 'suspended' })) {
      throw new AppError(403, 'owner_suspended', 'Your business is suspended; contact support to reopen it');
    }
    const now = services.now();
    const automatic = (await resolveGeneral(config)).ownerApproval === 'automatic';
    const { business } = input;
    const result = await withFreeSlug(input.venue.name, (slug) =>
      runInTransaction(async (session) => {
        const { owner } = await createOwnerIn(
          { userId, ...business, status: automatic ? 'active' : 'pending_approval' },
          now,
          session,
        );
        const ownerId = owner.id as string;
        const venue = await writeSetup(
          { ownerId, userId },
          input,
          { slug, country: business.country, currency: business.currency, settingsOn: 'owner', publish: automatic && input.publish },
          now,
          session,
        );
        return { owner, venue };
      }),
    );
    const ownerId = result.owner.id as string;
    await logPlatform(userId, { action: 'owner.applied', entity: 'owner', entityId: ownerId, ownerId }, now);
    if (automatic) await logPlatform(userId, { action: 'owner.auto_approved', entity: 'owner', entityId: ownerId, ownerId }, now);
    const body: SetupResult = {
      owner: { id: ownerId, name: result.owner.name, status: result.owner.status },
      venue: { id: result.venue.id as string, slug: result.venue.slug, published: result.venue.published },
    };
    res.status(201).json(body);
  });

  // The venue form's map-link lookup, for applicants who have no business to ask through yet.
  router.post('/onboarding/map-link', requireAuth(config, services), async (req, res) => {
    const { url } = mapLinkBody.parse(req.body);
    res.json({ url: await expandMapLink(url, services.fetch ?? fetch) });
  });

  return router;
}

/** The easy setup for a business that already runs: one more venue. Mounted on ownerRouter. */
export function ownerOnboardingRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.post('/onboarding', requirePermission('venue.manage', 'turf.manage', 'pricing.edit'), async (req, res) => {
    const t = tenantOf(req);
    // A venue-limited member could not see the venue they create.
    if (t.venueIds !== 'all') throw new AppError(403, 'forbidden', 'You do not have permission to do this');
    const input = venueSetupSchema.parse(req.body ?? {});
    await checkSetup(input);
    const owner = (await Owner.findById(t.ownerId, { name: 1, country: 1, defaultCurrency: 1, status: 1 }).lean())!;
    const now = services.now();
    const venue = await withFreeSlug(input.venue.name, (slug) =>
      runInTransaction((session) =>
        writeSetup(
          t,
          input,
          { slug, country: owner.country, currency: owner.defaultCurrency, settingsOn: 'venue', publish: input.publish },
          now,
          session,
        ),
      ),
    );
    const body: SetupResult = {
      owner: { id: t.ownerId, name: owner.name, status: owner.status },
      venue: { id: venue.id as string, slug: venue.slug, published: venue.published },
    };
    res.status(201).json(body);
  });

  return router;
}
