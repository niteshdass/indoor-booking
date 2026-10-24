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
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';
import { offeredAddons } from '../../src/addons/offered';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Addon.init(), AddonAssignment.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
let v2: string;
let t1: string;
let t2: string;
let t3: string;
let t4: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    Addon.deleteMany({}).setOptions({ crossTenant: true }),
    AddonAssignment.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId, { slug: 'v-one', published: true })).id as string;
  v2 = (await seedVenue(a.ownerId, { currency: 'USD', slug: 'v-two', published: true })).id as string;
  t1 = (await seedTurf(a.ownerId, v1)).id as string;
  t2 = (await seedTurf(a.ownerId, v1)).id as string;
  t3 = (await seedTurf(a.ownerId, v1, { indoor: true })).id as string;
  t4 = (await seedTurf(a.ownerId, v2)).id as string;
});

const api = () => request(ctx.app);
const root = (ownerId = a.ownerId) => `/api/v1/owners/${ownerId}`;
const mk = async (body: object, token = a.token, ownerId = a.ownerId) =>
  (await api().post(`${root(ownerId)}/addons`).set(...bearer(token)).send(body)).body.addon.id as string;
const putV = (venue: string, addon: string, body: object, token = a.token, ownerId = a.ownerId) =>
  api().put(`${root(ownerId)}/venues/${venue}/addons/${addon}`).set(...bearer(token)).send(body);
const putT = (venue: string, turf: string, addon: string, body: object, token = a.token) =>
  api().put(`${root()}/venues/${venue}/turfs/${turf}/addons/${addon}`).set(...bearer(token)).send(body);
const delV = (venue: string, addon: string, token = a.token) =>
  api().delete(`${root()}/venues/${venue}/addons/${addon}`).set(...bearer(token));
const offered = (venue: string, turf: string, token = a.token) =>
  api().get(`${root()}/venues/${venue}/turfs/${turf}/addons`).set(...bearer(token));
const towel = { name: 'Towel', pricingType: 'per_booking', price: 50 };
const prices = (res: request.Response) => res.body.addons.map((x: { name: string; unitPrice: number }) => [x.name, x.unitPrice]);

describe('offered add-ons', () => {
  it('venue assignment offers the add-on on every turf', async () => {
    const id = await mk(towel);
    expect((await putV(v1, id, { enabled: true })).status).toBe(200);
    expect(prices(await offered(v1, t1))).toEqual([['Towel', 50]]);
    expect(prices(await offered(v1, t2))).toEqual([['Towel', 50]]);
    expect((await putT(v1, t2, id, { enabled: false })).status).toBe(200);
    expect((await offered(v1, t2)).body.addons).toEqual([]);
    expect(prices(await offered(v1, t1))).toEqual([['Towel', 50]]);
    await putT(v1, t1, id, { enabled: true, priceOverride: 70 });
    expect(prices(await offered(v1, t1))).toEqual([['Towel', 70]]);
  });

  it('turf-only assignment', async () => {
    const id = await mk({ name: 'Racket', pricingType: 'per_unit', price: 100 });
    await putT(v1, t1, id, { enabled: true });
    expect(prices(await offered(v1, t1))).toEqual([['Racket', 100]]);
    expect((await offered(v1, t2)).body.addons).toEqual([]);
  });

  it('price chain: venue override flows to a turf assignment without one', async () => {
    const id = await mk(towel);
    await putV(v1, id, { enabled: true, priceOverride: 80 });
    await putT(v1, t1, id, { enabled: true });
    expect(prices(await offered(v1, t1))).toEqual([['Towel', 80]]);
  });

  it('stock resolution', async () => {
    const id = await mk({ ...towel, stock: 5 });
    await putV(v1, id, { enabled: true, stock: 2 });
    const venue = (await Venue.findOne({ ownerId: a.ownerId, _id: v1 }))!;
    const turf = (await Turf.findOne({ ownerId: a.ownerId, _id: t1 }))!;
    expect((await offeredAddons(a.ownerId, venue, turf))[0]!.stock).toBe(2);
    await putV(v1, id, { enabled: true });
    expect((await offeredAddons(a.ownerId, venue, turf))[0]!.stock).toBe(5);
    const res = await offered(v1, t1);
    expect(res.body.addons[0]).not.toHaveProperty('stock');
    expect((await putT(v1, t1, id, { enabled: true, stock: 1 })).status).toBe(400);
  });

  it('sorted by name', async () => {
    for (const name of ['zeta', 'Alpha', 'beta']) await putV(v1, await mk({ ...towel, name }), { enabled: true });
    expect((await offered(v1, t1)).body.addons.map((x: { name: string }) => x.name)).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('outdoorOnly auto add-on is dropped on indoor turfs', async () => {
    const id = await mk({ name: 'Floodlight', pricingType: 'per_hour', price: 30, autoApply: { outdoorOnly: true } });
    await putV(v1, id, { enabled: true });
    const out = await offered(v1, t1);
    expect(out.body.addons[0].autoApply).toEqual({ outdoorOnly: true });
    expect((await offered(v1, t3)).body.addons).toEqual([]);
  });

  it('another currency', async () => {
    const id = await mk(towel);
    const bad = await putV(v2, id, { enabled: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toEqual({ code: 'price_override_required', message: 'Set a price in USD for this venue' });
    expect((await putT(v2, t4, id, { enabled: true })).status).toBe(400);
    expect((await putV(v2, id, { enabled: false })).status).toBe(200);
    expect((await offered(v2, t4)).body.addons).toEqual([]);
    expect((await putV(v2, id, { enabled: true, priceOverride: 200 })).status).toBe(200);
    const out = await offered(v2, t4);
    expect(out.body.currency).toBe('USD');
    expect(prices(out)).toEqual([['Towel', 200]]);
    expect((await putT(v2, t4, id, { enabled: true })).status).toBe(200);
    // Venue-level price goes away: the turf assignment stays enabled but has no USD price.
    for (const drop of [() => putV(v2, id, { enabled: false }), () => delV(v2, id)]) {
      await putV(v2, id, { enabled: true, priceOverride: 200 });
      expect((await drop()).status).toBeLessThan(300);
      expect((await offered(v2, t4)).body.addons).toEqual([]);
      const pub = await api().get(`/api/v1/venues/v-two/turfs/${t4}/addons`);
      expect(pub.status).toBe(200);
      expect(pub.body.addons).toEqual([]);
    }
  });
});

describe('assignment writes', () => {
  it('activity', async () => {
    const id = await mk(towel);
    await putV(v1, id, { enabled: true });
    await putV(v1, id, { enabled: false });
    const logs = await ActivityLog.find({ ownerId: a.ownerId, action: 'addon.assign' }).sort({ _id: 1 });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ entity: 'addon', before: null });
    expect(String(logs[0]!.entityId)).toBe(id);
    expect(String(logs[0]!.venueId)).toBe(v1);
    expect(logs[1]!.before).toMatchObject({ enabled: true });
    expect(logs[1]!.after).toMatchObject({ enabled: false });
    expect((await delV(v1, id)).status).toBe(204);
    const un = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'addon.unassign' });
    expect(un!.before).toMatchObject({ addonId: id, enabled: false });
    const again = await delV(v1, id);
    expect(again.status).toBe(404);
    expect(again.body.error.message).toBe('Assignment not found');
  });

  it('GET lists venue and turf assignments', async () => {
    const id = await mk(towel);
    await putV(v1, id, { enabled: true });
    await putT(v1, t1, id, { enabled: false });
    const res = await api().get(`${root()}/venues/${v1}/addons`).set(...bearer(a.token));
    expect(res.body.assignments.map((x: { turfId: string | null }) => x.turfId)).toEqual([null, t1]);
  });

  it('tenancy and scope', async () => {
    const b = await seedOwner(ctx.services, { name: 'Other' });
    const bAddon = await mk(towel, b.token, b.ownerId);
    const id = await mk(towel);
    const foreign = await putV(v1, bAddon, { enabled: true });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.message).toBe('Add-on not found');
    expect((await putV(v1, 'nope', { enabled: true })).status).toBe(404);

    const mgr = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await putV(v1, id, { enabled: true }, mgr.token)).status).toBe(200);
    const out = await putV(v2, id, { enabled: true, priceOverride: 1 }, mgr.token);
    expect(out.status).toBe(404);
    expect(out.body.error.message).toBe('Venue not found');
    const wrongTurf = await putT(v1, t4, id, { enabled: true });
    expect(wrongTurf.status).toBe(404);
    expect(wrongTurf.body.error.message).toBe('Turf not found');

    const staff = await addMember(ctx.services, a.ownerId, { roleKey: 'staff', venueIds: [v1] });
    expect((await putV(v1, id, { enabled: true }, staff.token)).status).toBe(403);
    expect((await api().get(`${root()}/venues/${v1}/addons`).set(...bearer(staff.token))).status).toBe(403);
    expect((await offered(v1, t1, staff.token)).status).toBe(200);
    expect((await offered(v2, t4, staff.token)).status).toBe(404);
  });

  it('delete cascade', async () => {
    const id = await mk(towel);
    await putV(v1, id, { enabled: true });
    await putT(v1, t1, id, { enabled: false });
    expect((await api().delete(`${root()}/addons/${id}`).set(...bearer(a.token))).status).toBe(204);
    expect(await AddonAssignment.countDocuments({ ownerId: a.ownerId, addonId: id })).toBe(0);
  });

  it('concurrent assign and delete leave no orphan', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await mk({ ...towel, name: `Towel ${i}` });
      const [put, del] = await Promise.all([
        putV(v1, id, { enabled: true }),
        api().delete(`${root()}/addons/${id}`).set(...bearer(a.token)),
      ]);
      expect([200, 404]).toContain(put.status);
      expect(del.status).toBe(204);
      expect(await Addon.countDocuments({ ownerId: a.ownerId, _id: id })).toBe(0);
      expect(await AddonAssignment.countDocuments({ ownerId: a.ownerId, addonId: id })).toBe(0);
    }
  });
});

describe('public list', () => {
  const get = (slug: string, turf: string) => api().get(`/api/v1/venues/${slug}/turfs/${turf}/addons`);

  it('published venue lists offered add-ons', async () => {
    const id = await mk(towel);
    await putV(v1, id, { enabled: true });
    const res = await get('v-one', t1);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('BDT');
    expect(res.body.addons).toEqual([
      { id, name: 'Towel', pricingType: 'per_booking', unitPrice: 50, maxQuantity: 10, autoApply: null },
    ]);
  });

  it('unpublished venue, inactive turf, suspended owner → 404', async () => {
    await putV(v1, await mk(towel), { enabled: true });
    const hidden = await seedVenue(a.ownerId, { slug: 'v-hidden' });
    const ht = await seedTurf(a.ownerId, hidden.id as string);
    expect((await get('v-hidden', ht.id as string)).status).toBe(404);
    await Turf.updateOne({ ownerId: a.ownerId, _id: t2 }, { $set: { active: false } });
    expect((await get('v-one', t2)).status).toBe(404);
    expect((await get('v-one', 'bad')).status).toBe(404);
    expect((await get('v-one', t4)).status).toBe(404);
    await Owner.updateOne({ _id: a.ownerId }, { $set: { status: 'suspended' } });
    expect((await get('v-one', t1)).status).toBe(404);
  });
});
