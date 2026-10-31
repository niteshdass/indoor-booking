import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  ADMIN_PAGE_SIZE,
  OWNER_STATUSES,
  SUSPEND_REASON_MAX,
  type AdminOverviewJson,
  type AdminOwnerDetailJson,
  type AdminOwnersJson,
  type OwnerStatus,
  type PlatformAction,
} from '@booking/shared';
import { User } from '../../auth/user.model';
import { escapeRegExp } from '../../bookings/customers';
import { AppError } from '../../errors';
import { ratingJson } from '../../reviews/rating';
import { Review } from '../../reviews/review.model';
import type { AppServices } from '../../services';
import { Membership } from '../../tenancy/membership.model';
import { Owner } from '../../tenancy/owner.model';
import { systemRole } from '../../tenancy/role.model';
import { Turf } from '../../venues/turf.model';
import { Venue } from '../../venues/venue.model';
import { platformOf, requirePlatform } from '../context';
import { platformLogJson } from '../logJson';
import { PlatformLog, logPlatform } from '../platformLog.model';
import { bookingCounts, earnedByCurrency, feesByCurrency, ownerContacts, ownerRows, periodStart, sum } from '../stats';

const listQuery = z
  .object({
    status: z.enum(OWNER_STATUSES),
    q: z.string().trim().max(100),
    page: z.coerce.number().int().min(1).max(10_000),
  })
  .partial()
  .strict();
const suspendSchema = z.object({ reason: z.string().trim().min(1).max(SUSPEND_REASON_MAX) });

const ownerNotFound = () => new AppError(404, 'not_found', 'Owner not found');

const statusCounts = async (filter: Record<string, unknown> = {}): Promise<Record<OwnerStatus, number>> => {
  const rows = await Owner.aggregate<{ _id: OwnerStatus; n: number }>([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(OWNER_STATUSES.map((s) => [s, 0])) as Record<OwnerStatus, number>;
  for (const r of rows) counts[r._id] = r.n;
  return counts;
};

/** Owners whose name, or an owner-role member's name or email, matches `q`. */
async function searchFilter(q: string): Promise<Record<string, unknown>> {
  const re = new RegExp(escapeRegExp(q), 'i');
  const users = await User.find({ $or: [{ name: re }, { email: re }] }, { _id: 1 }).limit(200).lean();
  const role = await systemRole('owner');
  // Cross-owner by design: the platform admin searches every owner.
  const ownerIds = users.length
    ? await Membership.distinct('ownerId', { userId: { $in: users.map((u) => u._id) }, roleId: role._id }).setOptions({ crossTenant: true })
    : [];
  return { $or: [{ name: re }, { _id: { $in: ownerIds } }] };
}

/** Platform overview and owner management; mounted on the admin router. */
export function adminOwnersRouter(services: AppServices): Router {
  const router = Router();

  router.get('/overview', requirePlatform('platform.view'), async (_req, res) => {
    const now = services.now();
    const [from, prevFrom] = [periodStart(now), periodStart(now, 2)];
    const [owners, usersTotal, usersRecent, usersPrevious, venuesTotal, venuesPublished, recent, previous, earned, fees, openFlags, pending, newest] =
      await Promise.all([
        statusCounts(),
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: from, $lt: now } }),
        User.countDocuments({ createdAt: { $gte: prevFrom, $lt: from } }),
        Venue.countDocuments().setOptions({ crossTenant: true }),
        Venue.countDocuments({ published: true }).setOptions({ crossTenant: true }),
        bookingCounts(from, now),
        bookingCounts(prevFrom, from),
        earnedByCurrency(from, now),
        feesByCurrency(from, now),
        Review.countDocuments({ flag: { $ne: null }, moderation: 'visible' }).setOptions({ crossTenant: true }),
        Owner.find({ status: 'pending_approval' }).sort({ createdAt: 1, _id: 1 }).limit(5).lean(),
        Owner.find().sort({ createdAt: -1, _id: -1 }).limit(5).lean(),
      ]);
    const body: AdminOverviewJson = {
      owners,
      users: { total: usersTotal, recent: usersRecent, previous: usersPrevious },
      venues: { total: venuesTotal, published: venuesPublished },
      bookings: { recent: sum(recent), previous: sum(previous) },
      earned,
      fees,
      openFlags,
      pendingOwners: await ownerRows(pending, now),
      newestOwners: await ownerRows(newest, now),
    };
    res.json(body);
  });

  router.use('/owners', requirePlatform('platform.owners'));

  router.get('/owners', async (req, res) => {
    const q = listQuery.parse(req.query);
    const page = q.page ?? 1;
    const search = q.q ? await searchFilter(q.q) : {};
    const filter = q.status ? { ...search, status: q.status } : search;
    const [rows, total, counts] = await Promise.all([
      Owner.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * ADMIN_PAGE_SIZE)
        .limit(ADMIN_PAGE_SIZE)
        .lean(),
      Owner.countDocuments(filter),
      statusCounts(search),
    ]);
    const body: AdminOwnersJson = {
      owners: await ownerRows(rows, services.now(), { owes: true }),
      total,
      counts: { ...counts, all: sum(new Map(Object.entries(counts))) },
    };
    res.json(body);
  });

  const loadOwner = async (id: unknown) => {
    const owner = typeof id === 'string' && mongoose.isValidObjectId(id) ? await Owner.findById(id) : null;
    if (!owner) throw ownerNotFound();
    return owner;
  };

  router.get('/owners/:id', async (req, res) => {
    const owner = await loadOwner(req.params.id);
    const ownerId = owner.id as string;
    const now = services.now();
    const [contacts, members, venues, turfCounts, bookings, earned, log] = await Promise.all([
      ownerContacts([ownerId]),
      Membership.countDocuments({ ownerId, status: 'active' }),
      Venue.find({ ownerId }).sort({ name: 1, _id: 1 }).lean(),
      Turf.aggregate<{ _id: unknown; n: number }>([
        { $match: { ownerId: owner._id, active: true } },
        { $group: { _id: '$venueId', n: { $sum: 1 } } },
      ]),
      bookingCounts(periodStart(now), now, [ownerId]),
      earnedByCurrency(periodStart(now), now, ownerId),
      PlatformLog.find({ ownerId }).sort({ _id: -1 }).limit(20).lean(),
    ]);
    const courts = new Map(turfCounts.map((r) => [String(r._id), r.n]));
    const body: AdminOwnerDetailJson = {
      owner: {
        id: ownerId,
        name: owner.name,
        country: owner.country,
        currency: owner.defaultCurrency,
        locale: owner.defaultLocale,
        status: owner.status as OwnerStatus,
        createdAt: owner.createdAt.toISOString(),
      },
      contacts: contacts.get(ownerId) ?? [],
      members,
      venues: venues.map((v) => ({
        id: String(v._id),
        name: v.name,
        slug: v.slug,
        city: v.city,
        published: v.published,
        courts: courts.get(String(v._id)) ?? 0,
        rating: ratingJson(v.rating),
      })),
      recent: { bookings: sum(bookings), earned },
      history: await platformLogJson(log),
    };
    res.json(body);
  });

  /** Moves the owner from one of `from` to `to` and logs `action`; anything else is a 409. */
  const transition = (path: string, from: OwnerStatus[], to: OwnerStatus, action: PlatformAction, withReason = false) =>
    router.post(`/owners/:id/${path}`, async (req, res) => {
      const reason = withReason ? suspendSchema.parse(req.body ?? {}).reason : null;
      const owner = await loadOwner(req.params.id);
      // Conditional update, so two admins acting at once cannot both move it.
      const updated = await Owner.findOneAndUpdate(
        { _id: owner._id, status: { $in: from } },
        { $set: { status: to } },
        { new: true },
      );
      if (!updated) throw new AppError(409, 'invalid_status', `This business is ${owner.status.replace('_', ' ')}`);
      const ownerId = owner.id as string;
      await logPlatform(platformOf(req).userId, { action, entity: 'owner', entityId: ownerId, ownerId, reason }, services.now());
      res.json({ owner: { id: ownerId, status: updated.status } });
    });

  transition('approve', ['pending_approval'], 'active', 'owner.approved');
  transition('suspend', ['active', 'pending_approval'], 'suspended', 'owner.suspended', true);
  transition('reactivate', ['suspended'], 'active', 'owner.reactivated');

  return router;
}
