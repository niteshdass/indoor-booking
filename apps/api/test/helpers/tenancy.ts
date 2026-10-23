import type { MembershipStatus, SystemRoleKey } from '@booking/shared';
import { User } from '../../src/auth/user.model';
import { signAccessToken } from '../../src/auth/jwt';
import type { AppServices } from '../../src/services';
import { createOwner } from '../../src/tenancy/createOwner';
import { Membership } from '../../src/tenancy/membership.model';
import { systemRole } from '../../src/tenancy/role.model';
import { testConfig } from './testApp';

let seq = 0;

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

async function newUser(services: AppServices, name: string): Promise<{ userId: string; token: string }> {
  seq += 1;
  const user = await User.create({ name, email: `user${seq}@test.local` });
  const userId = user.id as string;
  return { userId, token: await signAccessToken(userId, testConfig.jwtSecret, services.now()) };
}

/** A fresh user who owns a fresh, active owner. */
export async function seedOwner(
  services: AppServices,
  opts: { name?: string } = {},
): Promise<{ ownerId: string; userId: string; token: string }> {
  const { userId, token } = await newUser(services, 'Owner User');
  const { owner } = await createOwner(
    { userId, name: opts.name ?? 'Arena', country: 'BD', currency: 'BDT' },
    services.now(),
  );
  return { ownerId: owner.id as string, userId, token };
}

/** A fresh user with a membership in `ownerId`; defaults to the staff role on all venues. */
export async function addMember(
  services: AppServices,
  ownerId: string,
  opts: {
    roleKey?: SystemRoleKey;
    roleId?: string;
    venueIds?: 'all' | string[];
    status?: MembershipStatus;
  } = {},
): Promise<{ userId: string; membershipId: string; token: string }> {
  const { userId, token } = await newUser(services, 'Member User');
  const roleId = opts.roleId ?? ((await systemRole(opts.roleKey ?? 'staff'))._id as unknown as string);
  const venueIds = opts.venueIds ?? 'all';
  const membership = await Membership.create({
    ownerId,
    userId,
    roleId,
    allVenues: venueIds === 'all',
    venueIds: venueIds === 'all' ? [] : venueIds,
    status: opts.status ?? 'active',
  });
  return { userId, membershipId: membership.id as string, token };
}
