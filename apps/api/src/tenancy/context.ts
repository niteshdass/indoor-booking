import type { Request, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { isPermission, type Permission, type SystemRoleKey } from '@booking/shared';
import { AppError } from '../errors';
import { Owner } from './owner.model';
import { Membership } from './membership.model';
import { Role } from './role.model';

export type TenantContext = {
  ownerId: string;
  userId: string;
  membershipId: string;
  roleId: string;
  roleKey: SystemRoleKey | null;
  permissions: ReadonlySet<Permission>;
  venueIds: 'all' | readonly string[];
};

// One answer for "no such owner" and "not yours" so owner ids cannot be probed.
const ownerNotFound = () => new AppError(404, 'not_found', 'Owner not found');

/** Resolves req.params.ownerId into req.tenant for the signed-in member; needs requireAuth first. */
export function requireTenant(): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.auth?.userId;
    if (!userId) throw new Error('requireTenant needs requireAuth first');
    const ownerId = req.params.ownerId;
    if (typeof ownerId !== 'string' || !mongoose.isValidObjectId(ownerId)) throw ownerNotFound();

    const membership = await Membership.findOne({ ownerId, userId, status: 'active' }).lean();
    if (!membership) throw ownerNotFound();
    const owner = await Owner.findById(ownerId, { status: 1 }).lean();
    if (!owner) throw ownerNotFound();
    if (owner.status !== 'active') {
      throw new AppError(403, 'owner_inactive', 'This business is not active');
    }
    // System roles have ownerId null; custom roles belong to this owner.
    const role = await Role.findOne({ _id: membership.roleId, ownerId: { $in: [null, ownerId] } }).lean();
    if (!role) throw ownerNotFound();

    req.tenant = {
      ownerId,
      userId,
      membershipId: String(membership._id),
      roleId: String(role._id),
      roleKey: ((role.system && role.key) || null) as SystemRoleKey | null,
      permissions: new Set(role.permissions.filter(isPermission)),
      venueIds: membership.allVenues ? 'all' : membership.venueIds.map(String),
    };
    next();
  };
}

export function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw new Error('tenantOf called before requireTenant');
  return req.tenant;
}

/** Requires every listed permission. */
export function requirePermission(...perms: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const t = tenantOf(req);
    if (!perms.every((p) => t.permissions.has(p))) {
      throw new AppError(403, 'forbidden', 'You do not have permission to do this');
    }
    next();
  };
}

export function hasVenueAccess(t: TenantContext, venueId: string): boolean {
  return t.venueIds === 'all' || t.venueIds.includes(venueId);
}

/** Venues outside the member's scope look missing, like other owners' data. */
export function assertVenueAccess(t: TenantContext, venueId: string): void {
  if (!hasVenueAccess(t, venueId)) throw new AppError(404, 'not_found', 'Venue not found');
}
