import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { createOwner } from '../../src/tenancy/createOwner';

const NOW = new Date('2026-01-01T00:00:00Z');

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Owner.deleteMany({}), Membership.deleteMany({ ownerId: { $exists: true } })]);
});

const input = (userId: string) => ({ userId, name: 'Arena', country: 'BD', currency: 'BDT' });

describe('createOwner', () => {
  it('creates owner and owner membership with all venues', async () => {
    const user = await User.create({ name: 'Ana' });
    const { owner, membership } = await createOwner(input(user.id as string), NOW);
    expect(owner).toMatchObject({ name: 'Arena', status: 'active', defaultLocale: 'en', defaultCurrency: 'BDT' });
    expect(membership.allVenues).toBe(true);
    const role = await Role.findOne({ ownerId: null, _id: membership.roleId });
    expect(role?.key).toBe('owner');
  });

  it('rejects bad country / unknown currency', async () => {
    const user = await User.create({ name: 'Ana' });
    await expect(createOwner({ ...input(user.id as string), country: 'bd' }, NOW)).rejects.toMatchObject({
      code: 'invalid_owner',
    });
    await expect(createOwner({ ...input(user.id as string), currency: 'XXX1' }, NOW)).rejects.toMatchObject({
      code: 'invalid_owner',
    });
    expect(await Owner.countDocuments()).toBe(0);
  });

  it('is atomic', async () => {
    await expect(createOwner(input('not-an-object-id'), NOW)).rejects.toThrow();
    expect(await Owner.countDocuments()).toBe(0);
  });
});
