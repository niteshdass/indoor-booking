import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { SYSTEM_ROLES } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { OtpCode } from '../../src/auth/otp.model';
import { OtpThrottle } from '../../src/auth/otpThrottle.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles, systemRole } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), OtpCode.init(), OtpThrottle.init(), RefreshToken.init(),
    Owner.init(), Role.init(), Membership.init(), ActivityLog.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let staffRoleId: string;
let managerRoleId: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    OtpCode.deleteMany({}),
    OtpThrottle.deleteMany({}),
    RefreshToken.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Role.deleteMany({ ownerId: { $ne: null } }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  staffRoleId = (await systemRole('staff')).id as string;
  managerRoleId = (await systemRole('manager')).id as string;
});

const api = () => request(ctx.app);
const oid = () => new mongoose.Types.ObjectId().toString();
const url = (ownerId: string, rest = '') => `/api/v1/owners/${ownerId}/members${rest}`;
const add = (token: string, body: object, ownerId = a.ownerId) =>
  api().post(url(ownerId)).set(...bearer(token)).send(body);
const PHONE = '+8801712345678';

describe('members API', () => {
  it('adds an existing user by email', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ name: 'Ana', email: ' Ana@X.com ', password: 'secret123' });
    await User.updateOne({ _id: reg.body.user.id }, { emailVerified: true });
    const before = await User.countDocuments();
    const res = await add(a.token, { name: 'Whoever', email: 'ana@x.com', roleId: staffRoleId, venueIds: 'all' });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      user: { id: reg.body.user.id, name: 'Ana', email: 'ana@x.com' },
      role: { id: staffRoleId, key: 'staff', name: 'Staff' },
      venueIds: 'all',
      status: 'active',
    });
    expect(await User.countDocuments()).toBe(before);
  });

  it('refuses to attach an unverified email account → 409 email_unverified', async () => {
    const mallory = await api().post('/api/v1/auth/register').send({ name: 'Mallory', email: 'staff@arena.com', password: 'secret123' });
    const res = await add(a.token, { name: 'Real Staff', email: 'staff@arena.com', roleId: staffRoleId, venueIds: 'all' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_unverified');
    expect(await Membership.exists({ ownerId: a.ownerId, userId: mallory.body.user.id })).toBeNull();
  });

  it('adds a new person by phone (stub user) who can then sign in', async () => {
    const res = await add(a.token, { name: 'Bo', phone: '+880 1712-345678', roleId: staffRoleId, venueIds: 'all' });
    expect(res.status).toBe(201);
    const stub = await User.findOne({ phone: PHONE });
    expect(stub).toMatchObject({ name: 'Bo', phoneVerified: false });
    await api().post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const login = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    expect(login.body.user.id).toBe(String(stub!._id));
    const me = await api().get(`/api/v1/owners/${a.ownerId}`).set(...bearer(login.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.membership.permissions).toEqual([...SYSTEM_ROLES.staff].sort());
  });

  it('email and phone together, or neither → 400 validation_error', async () => {
    const both = await add(a.token, { name: 'X', email: 'x@x.com', phone: PHONE, roleId: staffRoleId, venueIds: 'all' });
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('validation_error');
    const neither = await add(a.token, { name: 'X', roleId: staffRoleId, venueIds: 'all' });
    expect(neither.status).toBe(400);
    expect(neither.body.error.code).toBe('validation_error');
  });

  it('already a member → 409 already_member', async () => {
    const body = { name: 'X', email: 'x@x.com', roleId: staffRoleId, venueIds: 'all' };
    expect((await add(a.token, body)).status).toBe(201);
    const again = await add(a.token, body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_member');
  });

  it('owner role not assignable → 400 role_not_assignable; unknown role → 404', async () => {
    const ownerRole = await systemRole('owner');
    const res = await add(a.token, { name: 'X', email: 'x@x.com', roleId: ownerRole.id, venueIds: 'all' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('role_not_assignable');
    const unknown = await add(a.token, { name: 'X', email: 'x@x.com', roleId: oid(), venueIds: 'all' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
  });

  it('manager cannot be given more than the actor has', async () => {
    const [v1, v2] = [oid(), oid()];
    const hr = await Role.create({ ownerId: a.ownerId, name: 'HR', permissions: ['staff.manage', 'booking.view'] });
    const viewer = await Role.create({ ownerId: a.ownerId, name: 'Viewer', permissions: ['booking.view'] });
    const m = await addMember(ctx.services, a.ownerId, { roleId: String(hr._id), venueIds: [v1] });
    const cases: [object, number][] = [
      [{ roleId: managerRoleId, venueIds: [v1] }, 403],
      [{ roleId: String(viewer._id), venueIds: 'all' }, 403],
      [{ roleId: String(viewer._id), venueIds: [v2] }, 403],
    ];
    for (const [body, status] of cases) {
      const res = await add(m.token, { name: 'X', email: 'x@x.com', ...body });
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe('privilege_escalation');
    }
    const ok = await add(m.token, { name: 'X', email: 'x@x.com', roleId: String(viewer._id), venueIds: [v1, v1] });
    expect(ok.status).toBe(201);
    expect(ok.body.member.venueIds).toEqual([v1]);
    // Cannot touch someone whose current role exceeds the actor's.
    const mgr = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    const patch = await api().patch(url(a.ownerId, `/${mgr.membershipId}`)).set(...bearer(m.token)).send({ status: 'disabled' });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe('privilege_escalation');
  });

  it('owner membership is locked', async () => {
    const hr = await Role.create({ ownerId: a.ownerId, name: 'Everything', permissions: [...SYSTEM_ROLES.owner] });
    const m = await addMember(ctx.services, a.ownerId, { roleId: String(hr._id) });
    const ownerMembership = await Membership.findOne({ ownerId: a.ownerId, userId: a.userId });
    const patch = await api().patch(url(a.ownerId, `/${ownerMembership!.id}`)).set(...bearer(m.token)).send({ status: 'disabled' });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe('owner_membership_locked');
    const del = await api().delete(url(a.ownerId, `/${ownerMembership!.id}`)).set(...bearer(m.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('owner_membership_locked');
  });

  it('cannot modify self', async () => {
    const hr = await Role.create({ ownerId: a.ownerId, name: 'HR', permissions: ['staff.manage'] });
    const m = await addMember(ctx.services, a.ownerId, { roleId: String(hr._id) });
    const res = await api().patch(url(a.ownerId, `/${m.membershipId}`)).set(...bearer(m.token)).send({ status: 'disabled' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('cannot_modify_self');
    const ownerMembership = await Membership.findOne({ ownerId: a.ownerId, userId: a.userId });
    const own = await api().patch(url(a.ownerId, `/${ownerMembership!.id}`)).set(...bearer(a.token)).send({ venueIds: 'all' });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('cannot_modify_self');
  });

  it('disable then remove', async () => {
    const added = await add(a.token, { name: 'Bo', phone: PHONE, roleId: staffRoleId, venueIds: 'all' });
    const id = added.body.member.id;
    await api().post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const login = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    const patch = await api().patch(url(a.ownerId, `/${id}`)).set(...bearer(a.token)).send({ status: 'disabled' });
    expect(patch.status).toBe(200);
    expect(patch.body.member.status).toBe('disabled');
    const me = await api().get(`/api/v1/owners/${a.ownerId}`).set(...bearer(login.body.accessToken));
    expect(me.status).toBe(404);
    const del = await api().delete(url(a.ownerId, `/${id}`)).set(...bearer(a.token));
    expect(del.status).toBe(204);
    const actions = (await ActivityLog.find({ ownerId: a.ownerId, entity: 'member' })).map((e) => e.action).sort();
    expect(actions).toEqual(['member.add', 'member.remove', 'member.update']);
    const upd = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'member.update' }).lean();
    expect(upd?.before).toMatchObject({ status: 'active' });
    expect(upd?.after).toMatchObject({ status: 'disabled' });
  });

  it('lists members sorted by user name', async () => {
    await add(a.token, { name: 'Zed', email: 'z@x.com', roleId: staffRoleId, venueIds: 'all' });
    await add(a.token, { name: 'Amy', email: 'amy@x.com', roleId: staffRoleId, venueIds: 'all' });
    const res = await api().get(url(a.ownerId)).set(...bearer(a.token));
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { user: { name: string } }) => m.user.name)).toEqual(['Amy', 'Owner User', 'Zed']);
  });

  it("other owner's membership → 404", async () => {
    const b = await seedOwner(ctx.services);
    const bm = await addMember(ctx.services, b.ownerId);
    for (const id of [bm.membershipId, 'nope']) {
      const res = await api().patch(url(a.ownerId, `/${id}`)).set(...bearer(a.token)).send({ status: 'disabled' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect((await api().delete(url(a.ownerId, `/${bm.membershipId}`)).set(...bearer(a.token))).status).toBe(404);
  });

  it('staff cannot list members → 403 forbidden', async () => {
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    const res = await api().get(url(a.ownerId)).set(...bearer(staff.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});
