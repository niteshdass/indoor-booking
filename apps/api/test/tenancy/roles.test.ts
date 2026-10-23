import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles, systemRole } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Role.deleteMany({ ownerId: { $ne: null } }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const api = () => request(ctx.app);
const url = (ownerId: string, rest = '') => `/api/v1/owners/${ownerId}/roles${rest}`;
const createRole = (token: string, body: object, ownerId = a.ownerId) =>
  api().post(url(ownerId)).set(...bearer(token)).send(body);

describe('roles API', () => {
  it('lists system roles first then custom', async () => {
    await createRole(a.token, { name: 'Cashier', permissions: ['booking.view'] });
    await createRole(a.token, { name: 'Auditor', permissions: ['reports.view'] });
    const res = await api().get(url(a.ownerId)).set(...bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: { name: string }) => r.name)).toEqual(['Owner', 'Manager', 'Staff', 'Auditor', 'Cashier']);
    expect(res.body.roles[0]).toMatchObject({ key: 'owner', system: true, memberCount: 1 });
    expect(res.body.roles[3]).toMatchObject({ key: null, system: false, memberCount: 0 });
  });

  it('creates a custom role', async () => {
    const res = await createRole(a.token, { name: ' Cashier ', permissions: ['payment.mark_cash', 'booking.view'] });
    expect(res.status).toBe(201);
    expect(res.body.role).toMatchObject({ name: 'Cashier', system: false, permissions: ['booking.view', 'payment.mark_cash'], memberCount: 0 });
    const logged = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'role.create' });
    expect(String(logged?.entityId)).toBe(res.body.role.id);
  });

  it('rejects unknown permission key → 400 validation_error', async () => {
    const res = await createRole(a.token, { name: 'X', permissions: ['booking.view', 'nope.nope'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const empty = await createRole(a.token, { name: 'X', permissions: [] });
    expect(empty.status).toBe(400);
  });

  it('name clash → 409 role_name_taken', async () => {
    expect((await createRole(a.token, { name: 'manager', permissions: ['booking.view'] })).body.error.code).toBe('role_name_taken');
    expect((await createRole(a.token, { name: 'Cashier', permissions: ['booking.view'] })).status).toBe(201);
    const dup = await createRole(a.token, { name: ' cashier ', permissions: ['booking.view'] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('role_name_taken');
  });

  it('cannot grant permissions you lack → 403 privilege_escalation', async () => {
    const hr = await Role.create({ ownerId: a.ownerId, name: 'HR', permissions: ['staff.manage', 'booking.view'] });
    const m = await addMember(ctx.services, a.ownerId, { roleId: String(hr._id) });
    const res = await createRole(m.token, { name: 'Refunder', permissions: ['refund.issue'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('privilege_escalation');
    const ok = await createRole(m.token, { name: 'Viewer', permissions: ['booking.view'] });
    expect(ok.status).toBe(201);
    const patch = await api().patch(url(a.ownerId, `/${ok.body.role.id}`)).set(...bearer(m.token)).send({ permissions: ['refund.issue'] });
    expect(patch.body.error.code).toBe('privilege_escalation');
  });

  it('updates a custom role and logs before/after', async () => {
    const created = await createRole(a.token, { name: 'Cashier', permissions: ['booking.view'] });
    const res = await api()
      .patch(url(a.ownerId, `/${created.body.role.id}`))
      .set(...bearer(a.token))
      .send({ name: 'Till', permissions: ['booking.view', 'payment.mark_cash'] });
    expect(res.status).toBe(200);
    expect(res.body.role).toMatchObject({ name: 'Till', permissions: ['booking.view', 'payment.mark_cash'] });
    const logged = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'role.update' }).lean();
    expect(logged?.before).toEqual({ name: 'Cashier', permissions: ['booking.view'] });
    expect(logged?.after).toEqual({ name: 'Till', permissions: ['booking.view', 'payment.mark_cash'] });
    const empty = await api().patch(url(a.ownerId, `/${created.body.role.id}`)).set(...bearer(a.token)).send({});
    expect(empty.status).toBe(400);
  });

  it('system roles are read-only', async () => {
    const owner = await systemRole('owner');
    const patch = await api().patch(url(a.ownerId, `/${owner.id}`)).set(...bearer(a.token)).send({ name: 'Boss' });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe('system_role_readonly');
    const del = await api().delete(url(a.ownerId, `/${owner.id}`)).set(...bearer(a.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('system_role_readonly');
  });

  it('role in use cannot be deleted → 409 role_in_use; unused → 204', async () => {
    const used = await createRole(a.token, { name: 'Used', permissions: ['booking.view'] });
    await addMember(ctx.services, a.ownerId, { roleId: used.body.role.id, status: 'disabled' });
    const del = await api().delete(url(a.ownerId, `/${used.body.role.id}`)).set(...bearer(a.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('role_in_use');
    const unused = await createRole(a.token, { name: 'Unused', permissions: ['booking.view'] });
    const ok = await api().delete(url(a.ownerId, `/${unused.body.role.id}`)).set(...bearer(a.token));
    expect(ok.status).toBe(204);
    expect(await Role.exists({ _id: unused.body.role.id, ownerId: a.ownerId })).toBeNull();
    expect(await ActivityLog.exists({ ownerId: a.ownerId, action: 'role.delete' })).not.toBeNull();
  });

  it("other owner's role → 404", async () => {
    const b = await seedOwner(ctx.services);
    const bRole = await createRole(b.token, { name: 'B role', permissions: ['booking.view'] }, b.ownerId);
    for (const id of [bRole.body.role.id, 'not-an-id']) {
      const res = await api().patch(url(a.ownerId, `/${id}`)).set(...bearer(a.token)).send({ name: 'Mine' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    const del = await api().delete(url(a.ownerId, `/${bRole.body.role.id}`)).set(...bearer(a.token));
    expect(del.status).toBe(404);
  });

  it('staff role cannot manage roles → 403 forbidden', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    const res = await api().get(url(a.ownerId)).set(...bearer(staff.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});
