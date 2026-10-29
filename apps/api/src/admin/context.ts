import type { Request, RequestHandler } from 'express';
import { isPlatformPermission, type PlatformPermission, type PlatformRoleKey } from '@booking/shared';
import { User } from '../auth/user.model';
import { AppError } from '../errors';
import { Role } from '../tenancy/role.model';

export type PlatformContext = {
  userId: string;
  roleKey: PlatformRoleKey | null;
  roleName: string;
  permissions: ReadonlySet<PlatformPermission>;
};

const forbidden = () => new AppError(403, 'forbidden', 'You do not have permission to do this');

/** Requires a platform role holding every listed permission; needs requireAuth first. */
export function requirePlatform(...perms: PlatformPermission[]): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.auth?.userId;
    if (!userId) throw new Error('requirePlatform needs requireAuth first');
    if (!req.platform) {
      const user = await User.findById(userId, { platformRoleId: 1 }).lean();
      const role = user?.platformRoleId
        ? await Role.findOne({ _id: user.platformRoleId, ownerId: null, scope: 'platform' }).lean()
        : null;
      if (!role) throw forbidden();
      req.platform = {
        userId,
        roleKey: ((role.system && role.key) || null) as PlatformRoleKey | null,
        roleName: role.name,
        permissions: new Set(role.permissions.filter(isPlatformPermission)),
      };
    }
    if (!perms.every((p) => req.platform!.permissions.has(p))) throw forbidden();
    next();
  };
}

export function platformOf(req: Request): PlatformContext {
  if (!req.platform) throw new Error('platformOf called before requirePlatform');
  return req.platform;
}
