import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { PERMISSIONS, SYSTEM_ROLES } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([Role.init(), Membership.init()]);
});
afterAll(stopTestDb);
beforeEach(async () => {
  await Role.deleteMany({ ownerId: { $exists: true } });
  await Membership.deleteMany({ ownerId: { $exists: true } });
});

const oid = () => new mongoose.Types.ObjectId();

describe('system roles', () => {
  it('ensureSystemRoles creates owner/manager/staff once', async () => {
    await ensureSystemRoles();
    await ensureSystemRoles();
    expect(await Role.countDocuments({ ownerId: null, system: true })).toBe(3);
    const owner = await Role.findOne({ ownerId: null, key: 'owner' });
    expect([...(owner?.permissions ?? [])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('ensureSystemRoles repairs drifted permissions', async () => {
    await ensureSystemRoles();
    await Role.updateOne({ ownerId: null, key: 'staff' }, { $set: { permissions: [] } });
    await ensureSystemRoles();
    const staff = await Role.findOne({ ownerId: null, key: 'staff' });
    expect(staff?.permissions).toEqual([...SYSTEM_ROLES.staff]);
  });
});

describe('uniqueness', () => {
  it('role names are unique per owner, case-insensitive', async () => {
    const x = oid();
    await Role.create({ ownerId: x, name: 'Cashier', permissions: ['booking.view'] });
    await expect(
      Role.create({ ownerId: x, name: 'cashier', permissions: ['booking.view'] }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      Role.create({ ownerId: oid(), name: 'Cashier', permissions: ['booking.view'] }),
    ).resolves.toBeTruthy();
  });

  it('one membership per user per owner', async () => {
    const doc = { ownerId: oid(), userId: oid(), roleId: oid() };
    await Membership.create(doc);
    await expect(Membership.create(doc)).rejects.toMatchObject({ code: 11000 });
  });
});
