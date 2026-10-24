import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Closure, closureFor } from '../../src/schedule/closure.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
let v2: string;
let t1: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    Closure.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId)).id as string;
  v2 = (await seedVenue(a.ownerId)).id as string;
  t1 = (await seedTurf(a.ownerId, v1)).id as string;
});

const api = () => request(ctx.app);
const base = (ownerId = a.ownerId) => `/api/v1/owners/${ownerId}/closures`;
const post = (body: unknown, token = a.token) => api().post(base()).set(...bearer(token)).send(body as object);

describe('closures', () => {
  it('creates owner, venue and turf closures; closureFor finds each', async () => {
    const day = { from: '2026-12-16', to: '2026-12-16' };
    const o = await post({ ...day, reason: 'Holiday' });
    expect(o.status).toBe(201);
    expect(o.body.closure).toMatchObject({ venueId: null, turfId: null, ...day, reason: 'Holiday' });
    expect(await closureFor(a.ownerId, v1, t1, '2026-12-16')).toEqual({ reason: 'Holiday' });
    await api().delete(`${base()}/${o.body.closure.id}`).set(...bearer(a.token)).expect(204);
    expect(await closureFor(a.ownerId, v1, t1, '2026-12-16')).toBeNull();

    const v = await post({ venueId: v1, ...day, reason: 'Venue' });
    expect(v.status).toBe(201);
    expect(await closureFor(a.ownerId, v1, t1, '2026-12-16')).toEqual({ reason: 'Venue' });
    expect(await closureFor(a.ownerId, v2, t1, '2026-12-16')).toBeNull();
    await api().delete(`${base()}/${v.body.closure.id}`).set(...bearer(a.token)).expect(204);

    const t = await post({ venueId: v1, turfId: t1, ...day });
    expect(t.status).toBe(201);
    expect(t.body.closure.reason).toBeNull();
    expect(await closureFor(a.ownerId, v1, t1, '2026-12-16')).toEqual({ reason: null });
    expect(await closureFor(a.ownerId, v1, t1, '2026-12-17')).toBeNull();
    expect(await closureFor(a.ownerId, v1, String(new Turf()._id), '2026-12-16')).toBeNull();

    const list = await api().get(`${base()}?venueId=${v1}&turfId=${t1}`).set(...bearer(a.token));
    expect(list.body.closures).toHaveLength(1);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'closure.create' })).toBe(3);
    expect(await ActivityLog.countDocuments({ ownerId: a.ownerId, action: 'closure.delete' })).toBe(2);
  });

  it('validates ranges', async () => {
    const day = { from: '2026-12-16', to: '2026-12-16' };
    expect((await post({ from: '2026-12-16', to: '2026-12-15' })).status).toBe(400);
    expect((await post({ from: '2026-01-01', to: '2027-01-02' })).status).toBe(400);
    expect((await post({ from: '2026-01-01', to: '2027-01-01' })).status).toBe(201);
    expect((await post({ turfId: t1, ...day })).status).toBe(400);
    const other = (await seedTurf(a.ownerId, v2)).id as string;
    const res = await post({ venueId: v1, turfId: other, ...day });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Turf not found');
  });

  it('owner-level closure needs settings.edit and all-venue scope', async () => {
    const day = { from: '2026-12-16', to: '2026-12-16' };
    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: 'all' });
    const denied = await post(day, m.token);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');
    const limited = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await post({ venueId: v1, ...day }, limited.token)).status).toBe(201);
    expect((await post(day, limited.token)).status).toBe(403);
  });

  it('out of scope gives 404', async () => {
    const day = { from: '2026-12-16', to: '2026-12-16' };
    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    const res = await post({ venueId: v2, ...day }, m.token);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Venue not found');

    const own = (await post({ venueId: v2, ...day })).body.closure.id;
    expect((await api().delete(`${base()}/${own}`).set(...bearer(m.token))).status).toBe(404);
    const list = await api().get(base()).set(...bearer(m.token));
    expect(list.body.closures).toEqual([]);

    const b = await seedOwner(ctx.services, { name: 'B' });
    const bClosure = await api().post(base(b.ownerId)).set(...bearer(b.token)).send(day);
    expect(bClosure.status).toBe(201);
    const del = await api().delete(`${base()}/${bClosure.body.closure.id}`).set(...bearer(a.token));
    expect(del.status).toBe(404);
  });
});
