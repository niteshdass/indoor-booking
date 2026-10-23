import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { SYSTEM_ROLE_NAMES, isPermission, type Permission } from '@booking/shared';
import { AppError } from '../../errors';
import { isDuplicateKeyError, runInTransaction } from '../../db';
import type { AppServices } from '../../services';
import { logActivity } from '../activityLog.model';
import { assertCanGrant, requirePermission, tenantOf, type TenantContext } from '../context';
import { Membership } from '../membership.model';
import { Role } from '../role.model';

const nameSchema = z.string().trim().min(1).max(50);
const permissionsSchema = z
  .array(z.string().refine(isPermission, 'Unknown permission'))
  .min(1)
  .refine((ps) => new Set(ps).size === ps.length, 'Permissions must be unique')
  .transform((ps) => (ps as Permission[]).slice().sort());
const createSchema = z.object({ name: nameSchema, permissions: permissionsSchema });
const patchSchema = z
  .object({ name: nameSchema.optional(), permissions: permissionsSchema.optional() })
  .refine((b) => b.name !== undefined || b.permissions !== undefined, 'Nothing to update');

const SYSTEM_ORDER = Object.keys(SYSTEM_ROLE_NAMES);
const RESERVED_NAMES = new Set(Object.values(SYSTEM_ROLE_NAMES).map((n) => n.toLowerCase()));

type RoleRow = {
  _id: unknown;
  key?: string | null;
  name: string;
  system?: boolean | null;
  permissions: string[];
};

const nameTaken = () => new AppError(409, 'role_name_taken', 'A role with this name already exists');
const roleNotFound = () => new AppError(404, 'not_found', 'Role not found');
const readonly = () => new AppError(409, 'system_role_readonly', 'System roles cannot be changed');

function toRoleJson(role: RoleRow, memberCount: number) {
  return {
    id: String(role._id),
    key: (role.system && role.key) || null,
    name: role.name,
    system: Boolean(role.system),
    permissions: [...role.permissions].sort(),
    memberCount,
  };
}

async function memberCounts(ownerId: string): Promise<Map<string, number>> {
  const rows = await Membership.aggregate<{ _id: unknown; n: number }>([
    { $match: { ownerId: new mongoose.Types.ObjectId(ownerId) } },
    { $group: { _id: '$roleId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Loads an editable (custom) role of this owner; system roles and everything else are refused. */
async function editableRole(t: TenantContext, roleId: string) {
  if (!mongoose.isValidObjectId(roleId)) throw roleNotFound();
  if (await Role.exists({ _id: roleId, ownerId: null, system: true })) throw readonly();
  const role = await Role.findOne({ _id: roleId, ownerId: t.ownerId });
  if (!role) throw roleNotFound();
  // Editing a role changes what its holders can do, so the actor must cover both the role's
  // permissions and every venue its holders work at.
  assertCanGrant(t, role.permissions.filter(isPermission));
  if (t.venueIds !== 'all') {
    const ids = t.venueIds.map((id) => new mongoose.Types.ObjectId(id));
    const outside = await Membership.exists({
      ownerId: t.ownerId,
      roleId: role._id,
      $or: [{ allVenues: true }, { venueIds: { $elemMatch: { $nin: ids } } }],
    });
    if (outside) {
      throw new AppError(403, 'privilege_escalation', 'This role is held by staff outside your venues');
    }
  }
  return role;
}

function assertNameFree(name: string): void {
  if (RESERVED_NAMES.has(name.toLowerCase())) throw nameTaken();
}

/** Mounted on ownerRouter. */
export function rolesRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  router.use('/roles', requirePermission('staff.manage'));

  router.get('/roles', async (req, res) => {
    const t = tenantOf(req);
    const [roles, counts] = await Promise.all([
      Role.find({ ownerId: { $in: [t.ownerId, null] } }).lean(),
      memberCounts(t.ownerId),
    ]);
    const system = roles
      .filter((r) => r.system)
      .sort((x, y) => SYSTEM_ORDER.indexOf(x.key ?? '') - SYSTEM_ORDER.indexOf(y.key ?? ''));
    const custom = roles.filter((r) => !r.system).sort((x, y) => x.name.localeCompare(y.name));
    res.json({
      roles: [...system, ...custom].map((r) => toRoleJson(r, counts.get(String(r._id)) ?? 0)),
    });
  });

  router.post('/roles', async (req, res) => {
    const t = tenantOf(req);
    const { name, permissions } = createSchema.parse(req.body);
    assertNameFree(name);
    assertCanGrant(t, permissions);
    try {
      const role = await runInTransaction(async (session) => {
        const [created] = await Role.create([{ ownerId: t.ownerId, name, permissions }], { session });
        await logActivity(
          t,
          { action: 'role.create', entity: 'role', entityId: created!.id as string, after: { name, permissions } },
          services.now(),
          session,
        );
        return created!;
      });
      res.status(201).json({ role: toRoleJson(role, 0) });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken();
      throw err;
    }
  });

  router.patch('/roles/:roleId', async (req, res) => {
    const t = tenantOf(req);
    const input = patchSchema.parse(req.body);
    const role = await editableRole(t, req.params.roleId as string);
    if (input.name !== undefined) assertNameFree(input.name);
    if (input.permissions !== undefined) assertCanGrant(t, input.permissions);
    const before = { name: role.name, permissions: [...role.permissions].sort() };
    const after = {
      name: input.name ?? before.name,
      permissions: input.permissions ?? before.permissions,
    };
    try {
      await runInTransaction(async (session) => {
        await Role.updateOne({ _id: role._id, ownerId: t.ownerId }, { $set: after }, { session });
        await logActivity(
          t,
          { action: 'role.update', entity: 'role', entityId: role.id as string, before, after },
          services.now(),
          session,
        );
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw nameTaken();
      throw err;
    }
    const counts = await memberCounts(t.ownerId);
    res.json({
      role: toRoleJson({ ...role.toObject(), ...after }, counts.get(role.id as string) ?? 0),
    });
  });

  router.delete('/roles/:roleId', async (req, res) => {
    const t = tenantOf(req);
    const role = await editableRole(t, req.params.roleId as string);
    await runInTransaction(async (session) => {
      if (await Membership.exists({ ownerId: t.ownerId, roleId: role._id }).session(session)) {
        throw new AppError(409, 'role_in_use', 'Reassign members before deleting this role');
      }
      await Role.deleteOne({ _id: role._id, ownerId: t.ownerId }, { session });
      await logActivity(
        t,
        {
          action: 'role.delete',
          entity: 'role',
          entityId: role.id as string,
          before: { name: role.name, permissions: [...role.permissions].sort() },
        },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
