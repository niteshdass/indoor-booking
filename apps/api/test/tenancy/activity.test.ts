import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog, logActivity, logSystemActivity } from '../../src/tenancy/activityLog.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Role.deleteMany({ ownerId: { $ne: null } }),
  ]);
  ctx = buildTestApp();
});

const api = () => request(ctx.app);
const oid = () => new mongoose.Types.ObjectId().toString();
const at = (n: number) => new Date(Date.UTC(2026, 0, 2, 0, n));

async function log(ownerId: string, userId: string, action: string, n: number, venueId?: string) {
  await logActivity({ ownerId, userId }, { action, entity: 'thing', entityId: oid(), venueId }, at(n));
}
const activity = (ownerId: string, token: string, query = '') =>
  api().get(`/api/v1/owners/${ownerId}/activity${query}`).set(...bearer(token));

describe('activity log', () => {
  it('createOwner writes owner.create', async () => {
    const a = await seedOwner(ctx.services);
    const entries = await ActivityLog.find({ ownerId: a.ownerId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'owner.create', entity: 'owner' });
    expect(String(entries[0]!.actorId)).toBe(a.userId);
    expect(String(entries[0]!.entityId)).toBe(a.ownerId);
    expect(entries[0]!.after).toEqual({ name: 'Arena', country: 'BD', defaultCurrency: 'BDT' });
  });

  it('owner pages through activity newest first', async () => {
    const a = await seedOwner(ctx.services);
    await ActivityLog.deleteMany({ ownerId: a.ownerId });
    await log(a.ownerId, a.userId, 'thing.one', 1);
    await log(a.ownerId, a.userId, 'thing.two', 2);
    await log(a.ownerId, a.userId, 'thing.three', 3);
    const first = await activity(a.ownerId, a.token, '?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.items.map((i: { action: string }) => i.action)).toEqual(['thing.three', 'thing.two']);
    expect(first.body.items[0]).toMatchObject({ entity: 'thing', actor: { id: a.userId, name: 'Owner User' }, at: at(3).toISOString() });
    expect(first.body.nextBefore).toBe(first.body.items[1].id);
    const rest = await activity(a.ownerId, a.token, `?before=${first.body.nextBefore}&limit=2`);
    expect(rest.body.items.map((i: { action: string }) => i.action)).toEqual(['thing.one']);
    expect(rest.body.nextBefore).toBeNull();
  });

  it('staff without reports.view → 403 forbidden', async () => {
    const a = await seedOwner(ctx.services);
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    const res = await activity(a.ownerId, staff.token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it("venue-limited member sees only their venues' entries", async () => {
    const a = await seedOwner(ctx.services);
    const [v1, v2] = [oid(), oid()];
    const role = await Role.create({ ownerId: a.ownerId, name: 'Auditor', permissions: ['reports.view'] });
    const m = await addMember(ctx.services, a.ownerId, { roleId: String(role._id), venueIds: [v1] });
    await log(a.ownerId, a.userId, 'thing.v1', 1, v1);
    await log(a.ownerId, a.userId, 'thing.v2', 2, v2);
    await log(a.ownerId, a.userId, 'thing.none', 3);
    const res = await activity(a.ownerId, m.token);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { action: string }) => i.action)).toEqual(['thing.v1']);
    expect(res.body.items[0].venueId).toBe(v1);
  });

  it("other owner's entries never appear", async () => {
    const a = await seedOwner(ctx.services);
    const b = await seedOwner(ctx.services);
    await log(b.ownerId, b.userId, 'thing.b', 5);
    const res = await activity(a.ownerId, a.token);
    expect(res.body.items.map((i: { action: string }) => i.action)).toEqual(['owner.create']);
  });

  it('before=garbage → 400 validation_error', async () => {
    const a = await seedOwner(ctx.services);
    const res = await activity(a.ownerId, a.token, '?before=garbage');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('lists a system entry', async () => {
    const a = await seedOwner(ctx.services);
    await logSystemActivity(a.ownerId, { action: 'booking.confirmed', entity: 'booking', entityId: oid() }, at(9));
    const res = await activity(a.ownerId, a.token);
    expect(res.status).toBe(200);
    const item = res.body.items.find((i: { action: string }) => i.action === 'booking.confirmed');
    expect(item.actor).toBeNull();
  });
});
