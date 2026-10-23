import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { MEMBERSHIP_STATUSES, isPermission } from '@booking/shared';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { normalizeEmail, normalizePhone } from '../../auth/normalize';
import { nameSchema } from '../../auth/routes/emailAuth';
import { User } from '../../auth/user.model';
import { logActivity } from '../activityLog.model';
import { assertCanGrant, requirePermission, tenantOf, type TenantContext } from '../context';
import { Membership } from '../membership.model';
import { Role } from '../role.model';

const objectIdString = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id');
const venueIdsSchema = z
  .union([z.literal('all'), z.array(objectIdString).max(500)])
  .transform((v) => (v === 'all' ? v : [...new Set(v.map((id) => id.toLowerCase()))]));
type VenueIds = z.infer<typeof venueIdsSchema>;

const addSchema = z
  .object({
    name: nameSchema,
    email: z.string().optional(),
    phone: z.string().optional(),
    roleId: z.string(),
    venueIds: venueIdsSchema,
  })
  .refine((b) => (b.email === undefined) !== (b.phone === undefined), 'Give exactly one of email or phone');
const patchSchema = z
  .object({
    roleId: z.string().optional(),
    venueIds: venueIdsSchema.optional(),
    status: z.enum(MEMBERSHIP_STATUSES).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to update');

const memberNotFound = () => new AppError(404, 'not_found', 'Member not found');
const escalation = () =>
  new AppError(403, 'privilege_escalation', 'You cannot grant access you do not have');

type RoleLean = { _id: unknown; key?: string | null; name: string; system?: boolean | null; permissions: string[] };

/** A role this owner may assign: one of its custom roles, or a system role other than owner. */
async function assignableRole(t: TenantContext, roleId: string): Promise<RoleLean> {
  const role = mongoose.isValidObjectId(roleId)
    ? await Role.findOne({ _id: roleId, ownerId: { $in: [t.ownerId, null] } }).lean()
    : null;
  if (!role) throw new AppError(404, 'not_found', 'Role not found');
  if (role.system && role.key === 'owner') {
    throw new AppError(400, 'role_not_assignable', 'The owner role cannot be assigned');
  }
  return role;
}

function assertRoleWithinActor(t: TenantContext, role: RoleLean): void {
  assertCanGrant(t, role.permissions.filter(isPermission));
}

function assertVenuesWithinActor(t: TenantContext, venueIds: VenueIds): void {
  if (t.venueIds === 'all') return;
  const mine = t.venueIds;
  if (venueIds === 'all' || !venueIds.every((v) => mine.includes(v))) throw escalation();
}

const venueIdsOf = (m: { allVenues?: boolean | null; venueIds: unknown[] }): VenueIds =>
  m.allVenues ? 'all' : m.venueIds.map(String);

function memberJson(
  doc: { _id: unknown; userId: unknown; roleId: unknown; allVenues: boolean; venueIds: unknown[]; status: string; createdAt: Date },
  user: { name?: string | null; email?: string | null; phone?: string | null } | null,
  role: RoleLean | null,
) {
  return {
    id: String(doc._id),
    user: {
      id: String(doc.userId),
      name: user?.name ?? '',
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },
    role: {
      id: String(doc.roleId),
      key: (role?.system && role.key) || null,
      name: role?.name ?? '',
    },
    venueIds: venueIdsOf(doc),
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Finds the person by email/phone, or creates a stub account they claim when they first sign in. */
async function findOrCreateUser(input: { name: string; email?: string; phone?: string }) {
  const key = input.email !== undefined
    ? { email: normalizeEmail(input.email) }
    : { phone: normalizePhone(input.phone!) };
  const existing = await User.findOne(key);
  if (existing) return existing;
  try {
    return await User.create({ name: input.name, ...key });
  } catch (err) {
    // Someone registered (or was added elsewhere) concurrently.
    if (!isDuplicateKeyError(err)) throw err;
    const user = await User.findOne(key);
    if (!user) throw err;
    return user;
  }
}

/** Loads a membership of this owner that the actor may change. */
async function editableMembership(t: TenantContext, membershipId: string) {
  const m = mongoose.isValidObjectId(membershipId)
    ? await Membership.findOne({ _id: membershipId, ownerId: t.ownerId })
    : null;
  if (!m) throw memberNotFound();
  if (String(m.userId) === t.userId) {
    throw new AppError(409, 'cannot_modify_self', 'You cannot change your own membership');
  }
  const role = await Role.findOne({ _id: m.roleId, ownerId: { $in: [t.ownerId, null] } }).lean();
  if (role?.system && role.key === 'owner') {
    throw new AppError(409, 'owner_membership_locked', "The owner's membership cannot be changed");
  }
  if (role) assertRoleWithinActor(t, role);
  assertVenuesWithinActor(t, venueIdsOf(m));
  return m;
}

const snapshot = (m: { roleId: unknown; allVenues: boolean; venueIds: unknown[]; status: string }) => ({
  roleId: String(m.roleId),
  venueIds: venueIdsOf(m),
  status: m.status,
});

/** Mounted on ownerRouter. */
export function membersRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  router.use('/members', requirePermission('staff.manage'));

  router.get('/members', async (req, res) => {
    const t = tenantOf(req);
    const members = await Membership.find({ ownerId: t.ownerId }).lean();
    const [users, roles] = await Promise.all([
      User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1, email: 1, phone: 1 }).lean(),
      Role.find({ _id: { $in: members.map((m) => m.roleId) }, ownerId: { $in: [t.ownerId, null] } }).lean(),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    const out = members.map((m) =>
      memberJson(m, userById.get(String(m.userId)) ?? null, roleById.get(String(m.roleId)) ?? null),
    );
    out.sort((x, y) => x.user.name.localeCompare(y.user.name));
    res.json({ members: out });
  });

  router.post('/members', async (req, res) => {
    const t = tenantOf(req);
    const input = addSchema.parse(req.body);
    const role = await assignableRole(t, input.roleId);
    assertRoleWithinActor(t, role);
    assertVenuesWithinActor(t, input.venueIds);
    // Outside the transaction: a duplicate-key error would abort it, and the re-find needs to run.
    const user = await findOrCreateUser(input);
    const allVenues = input.venueIds === 'all';
    try {
      const member = await runInTransaction(async (session) => {
        const [created] = await Membership.create(
          [
            {
              ownerId: t.ownerId,
              userId: user._id,
              roleId: role._id,
              allVenues,
              venueIds: allVenues ? [] : input.venueIds,
            },
          ],
          { session },
        );
        await logActivity(
          t,
          { action: 'member.add', entity: 'member', entityId: created!.id as string, after: snapshot(created!) },
          services.now(),
          session,
        );
        return created!;
      });
      res.status(201).json({ member: memberJson(member, user, role) });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new AppError(409, 'already_member', 'This person is already a member');
      }
      throw err;
    }
  });

  router.patch('/members/:membershipId', async (req, res) => {
    const t = tenantOf(req);
    const input = patchSchema.parse(req.body);
    const m = await editableMembership(t, req.params.membershipId as string);
    if (input.roleId !== undefined) assertRoleWithinActor(t, await assignableRole(t, input.roleId));
    if (input.venueIds !== undefined) assertVenuesWithinActor(t, input.venueIds);
    const before = snapshot(m);
    if (input.roleId !== undefined) m.roleId = new mongoose.Types.ObjectId(input.roleId);
    if (input.venueIds !== undefined) {
      m.allVenues = input.venueIds === 'all';
      m.set('venueIds', input.venueIds === 'all' ? [] : input.venueIds);
    }
    if (input.status !== undefined) m.status = input.status;
    await runInTransaction(async (session) => {
      await m.save({ session });
      await logActivity(
        t,
        { action: 'member.update', entity: 'member', entityId: m.id as string, before, after: snapshot(m) },
        services.now(),
        session,
      );
    });
    const [user, role] = await Promise.all([
      User.findById(m.userId, { name: 1, email: 1, phone: 1 }).lean(),
      Role.findOne({ _id: m.roleId, ownerId: { $in: [t.ownerId, null] } }).lean(),
    ]);
    res.json({ member: memberJson(m, user, role) });
  });

  router.delete('/members/:membershipId', async (req, res) => {
    const t = tenantOf(req);
    const m = await editableMembership(t, req.params.membershipId as string);
    await runInTransaction(async (session) => {
      await Membership.deleteOne({ _id: m._id, ownerId: t.ownerId }, { session });
      await logActivity(
        t,
        { action: 'member.remove', entity: 'member', entityId: m.id as string, before: snapshot(m) },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
