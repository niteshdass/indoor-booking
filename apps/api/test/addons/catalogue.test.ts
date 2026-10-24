import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Addon.init(), AddonAssignment.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Addon.deleteMany({}).setOptions({ crossTenant: true }),
    AddonAssignment.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId)).id as string;
});

const api = () => request(ctx.app);
const base = (ownerId = a.ownerId) => `/api/v1/owners/${ownerId}/addons`;
const post = (body: unknown, token = a.token, ownerId = a.ownerId) =>
  api().post(base(ownerId)).set(...bearer(token)).send(body as object);
const patch = (id: string, body: unknown, token = a.token, ownerId = a.ownerId) =>
  api().patch(`${base(ownerId)}/${id}`).set(...bearer(token)).send(body as object);
const del = (id: string, token = a.token, ownerId = a.ownerId) =>
  api().delete(`${base(ownerId)}/${id}`).set(...bearer(token));
const list = (token = a.token) => api().get(base()).set(...bearer(token));
const towel = { name: 'Towel', pricingType: 'per_booking', price: 50 };

describe('add-on catalogue', () => {
  it('creates, lists, patches and deletes', async () => {
    const created = await post(towel);
    expect(created.status).toBe(201);
    expect(created.body.addon).toMatchObject({
      name: 'Towel', pricingType: 'per_booking', price: 50, currency: 'BDT', maxQuantity: 10, stock: null, autoApply: null,
    });
    const id = created.body.addon.id as string;
    await post({ name: 'racket', pricingType: 'per_unit', price: 200, stock: 4 });

    const listed = await list();
    expect(listed.body.addons.map((x: { name: string }) => x.name)).toEqual(['racket', 'Towel']);

    const patched = await patch(id, { price: 60 });
    expect(patched.status).toBe(200);
    expect(patched.body.addon.price).toBe(60);

    expect((await del(id)).status).toBe(204);
    expect((await list()).body.addons.map((x: { name: string }) => x.name)).toEqual(['racket']);

    const rows = await ActivityLog.find({ ownerId: a.ownerId, entity: 'addon', entityId: id }).sort({ at: 1, _id: 1 });
    expect(rows.map((r) => r.action)).toEqual(['addon.create', 'addon.update', 'addon.delete']);
    expect(rows[1]!.before).toEqual({ price: 50 });
    expect(rows[1]!.after).toEqual({ price: 60 });
  });

  it('keeps a Russian name', async () => {
    const res = await post({ ...towel, name: 'Полотенце' });
    expect(res.status).toBe(201);
    expect((await list()).body.addons[0].name).toBe('Полотенце');
  });

  it('rejects bad input', async () => {
    const bad: unknown[] = [
      { ...towel, price: 10.5 },
      { ...towel, price: -1 },
      { ...towel, name: '' },
      { ...towel, name: 'x'.repeat(61) },
      { ...towel, pricingType: 'per_day' },
      { ...towel, stock: -1 },
      { ...towel, maxQuantity: 0 },
      { ...towel, extra: 1 },
      { ...towel, pricingType: 'per_unit', autoApply: { outdoorOnly: true } },
      { ...towel, stock: 3, autoApply: { outdoorOnly: true } },
      { ...towel, autoApply: { range: { start: '25:00', end: '10:00' }, outdoorOnly: false } },
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    const id = (await post({ ...towel, autoApply: { outdoorOnly: true } })).body.addon.id as string;
    expect((await patch(id, { pricingType: 'per_unit' })).status).toBe(400);
    expect((await patch(id, { stock: 3 })).status).toBe(400);
    const empty = await patch(id, {});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('validation_error');
  });

  it('refuses auto-apply while venues limit stock', async () => {
    const id = (await post(towel)).body.addon.id as string;
    const putVenue = (body: object) =>
      api().put(`${base()}/${id}`.replace('/addons/', `/venues/${v1}/addons/`)).set(...bearer(a.token)).send(body);
    expect((await putVenue({ enabled: true, stock: 2 })).status).toBe(200);
    const auto = { autoApply: { outdoorOnly: true } };
    const res = await patch(id, auto);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect((await list()).body.addons[0].autoApply).toBeNull();
    expect((await putVenue({ enabled: true, stock: null })).status).toBe(200);
    expect((await patch(id, auto)).status).toBe(200);
  });

  it('name is unique per owner, case-insensitive', async () => {
    const first = await post(towel);
    const dup = await post({ ...towel, name: 'towel' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('addon_name_taken');
    const other = await post({ ...towel, name: 'Mat' });
    expect((await patch(other.body.addon.id, { name: 'TOWEL' })).status).toBe(409);
    expect(first.status).toBe(201);

    const b = await seedOwner(ctx.services, { name: 'Other' });
    expect((await post(towel, b.token, b.ownerId)).status).toBe(201);
  });

  it('permissions', async () => {
    const id = (await post(towel)).body.addon.id as string;
    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff' });
    expect((await list(staff.token)).status).toBe(403);

    const mgr = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: 'all' });
    expect((await post({ ...towel, name: 'Mat' }, mgr.token)).status).toBe(201);

    const limited = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    for (const res of [
      await post({ ...towel, name: 'Cap' }, limited.token),
      await patch(id, { price: 70 }, limited.token),
      await del(id, limited.token),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    expect((await list(limited.token)).status).toBe(200);
  });

  it('tenancy: other owner and malformed ids give identical 404s', async () => {
    const b = await seedOwner(ctx.services, { name: 'Other' });
    const theirs = (await post(towel, b.token, b.ownerId)).body.addon.id as string;
    const results = [
      await patch(theirs, { price: 1 }),
      await del(theirs),
      await patch('nope', { price: 1 }),
      await del('nope'),
    ];
    for (const res of results) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(results[0]!.body);
    }
    expect(await Addon.countDocuments({ ownerId: b.ownerId })).toBe(1);
  });
});
