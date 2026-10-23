import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { PERMISSIONS } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { requireAuth } from '../../src/auth/requireAuth';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { requirePermission, requireTenant, tenantOf } from '../../src/tenancy/context';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
  ]);
  const services = makeTestServices();
  ctx = buildTestApp({
    services,
    extraRoutes: (router) => {
      router.get(
        '/probe/:ownerId',
        requireAuth(testConfig, services),
        requireTenant(),
        requirePermission('refund.issue'),
        (req, res) => {
          res.json({ venueIds: tenantOf(req).venueIds });
        },
      );
    },
  });
});

const api = () => request(ctx.app);
const NOT_FOUND = { error: { code: 'not_found', message: 'Owner not found' } };

describe('tenant context', () => {
  it('owner sees their owner and full permissions', async () => {
    const a = await seedOwner(ctx.services, { name: 'Alpha' });
    const res = await api().get(`/api/v1/owners/${a.ownerId}`).set(...bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.owner).toMatchObject({ id: a.ownerId, name: 'Alpha', country: 'BD', defaultCurrency: 'BDT', defaultLocale: 'en', status: 'active' });
    expect(res.body.membership.role.key).toBe('owner');
    expect(res.body.membership.permissions).toEqual([...PERMISSIONS].sort());
    expect(res.body.membership.venueIds).toBe('all');
  });

  it('non-members get identical 404s', async () => {
    const a = await seedOwner(ctx.services);
    const b = await seedOwner(ctx.services);
    const disabled = await addMember(ctx.services, a.ownerId, { status: 'disabled' });
    const cases: [string, string][] = [
      [b.ownerId, a.token],
      ['not-an-id', a.token],
      [new mongoose.Types.ObjectId().toString(), a.token],
      [a.ownerId, disabled.token],
    ];
    for (const [id, token] of cases) {
      const res = await api().get(`/api/v1/owners/${id}`).set(...bearer(token));
      expect(res.status, id).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });

  it('suspended owner → 403 owner_inactive', async () => {
    const a = await seedOwner(ctx.services);
    await Owner.updateOne({ _id: a.ownerId }, { status: 'suspended' });
    const res = await api().get(`/api/v1/owners/${a.ownerId}`).set(...bearer(a.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('owner_inactive');
  });

  it('no token → 401 unauthenticated', async () => {
    const a = await seedOwner(ctx.services);
    const res = await api().get(`/api/v1/owners/${a.ownerId}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('staff lacks refund.issue → 403 forbidden; owner passes', async () => {
    const a = await seedOwner(ctx.services);
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    const denied = await api().get(`/api/v1/probe/${a.ownerId}`).set(...bearer(staff.token));
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: { code: 'forbidden', message: 'You do not have permission to do this' } });
    const ok = await api().get(`/api/v1/probe/${a.ownerId}`).set(...bearer(a.token));
    expect(ok.status).toBe(200);
    expect(ok.body.venueIds).toBe('all');
  });

  it("limited member's venueIds are strings", async () => {
    const a = await seedOwner(ctx.services);
    const v1 = new mongoose.Types.ObjectId().toString();
    const v2 = new mongoose.Types.ObjectId().toString();
    const mgr = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1, v2] });
    const res = await api().get(`/api/v1/probe/${a.ownerId}`).set(...bearer(mgr.token));
    expect(res.status).toBe(200);
    expect(res.body.venueIds).toEqual([v1, v2]);
  });

  it('GET /me/memberships lists active memberships only', async () => {
    const a = await seedOwner(ctx.services, { name: 'Alpha' });
    const b = await seedOwner(ctx.services, { name: 'Beta' });
    const staffRole = await Role.findOne({ ownerId: null, system: true, key: 'staff' });
    await Membership.create({ ownerId: b.ownerId, userId: a.userId, roleId: staffRole!._id, status: 'disabled' });
    const res = await api().get('/api/v1/me/memberships').set(...bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0]).toMatchObject({
      ownerId: a.ownerId,
      ownerName: 'Alpha',
      ownerStatus: 'active',
      role: { key: 'owner', name: 'Owner' },
      venueIds: 'all',
    });
  });
});
