import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { bearer, seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { ActivityLog } from '../../src/tenancy/activityLog.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { Closure } from '../../src/schedule/closure.model';
import { Addon } from '../../src/addons/addon.model';
import { AddonAssignment } from '../../src/addons/assignment.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(), Addon.init(), AddonAssignment.init(),
  ]);
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
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
    Closure.deleteMany({}).setOptions({ crossTenant: true }),
    Addon.deleteMany({}).setOptions({ crossTenant: true }),
    AddonAssignment.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const ROUNDS = 10;
const root = () => `/api/v1/owners/${a.ownerId}`;
const api = () => request(ctx.app);
const day = { from: '2026-12-16', to: '2026-12-16' };

async function addon(): Promise<string> {
  const res = await api().post(`${root()}/addons`).set(...bearer(a.token))
    .send({ name: 'Towel', pricingType: 'per_booking', price: 50 });
  return res.body.addon.id as string;
}

describe('carry-over locks: no orphans when the target is deleted concurrently', () => {
  it('closure create racing turf delete leaves no orphan', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const v = (await seedVenue(a.ownerId, { slug: `v-${i}` })).id as string;
      const t = (await seedTurf(a.ownerId, v)).id as string;
      const [created, deleted] = await Promise.all([
        api().post(`${root()}/closures`).set(...bearer(a.token)).send({ venueId: v, turfId: t, ...day }),
        api().delete(`${root()}/venues/${v}/turfs/${t}`).set(...bearer(a.token)),
      ]);
      expect([201, 404]).toContain(created.status);
      expect(deleted.status).toBe(204);
      expect(await Turf.exists({ ownerId: a.ownerId, _id: t })).toBeNull();
      expect(await Closure.countDocuments({ ownerId: a.ownerId, turfId: t })).toBe(0);
    }
  }, 60_000);

  it('turf assignment racing turf delete', async () => {
    const id = await addon();
    for (let i = 0; i < ROUNDS; i++) {
      const v = (await seedVenue(a.ownerId, { slug: `v-${i}` })).id as string;
      const t = (await seedTurf(a.ownerId, v)).id as string;
      const [put, deleted] = await Promise.all([
        api().put(`${root()}/venues/${v}/turfs/${t}/addons/${id}`).set(...bearer(a.token)).send({ enabled: true }),
        api().delete(`${root()}/venues/${v}/turfs/${t}`).set(...bearer(a.token)),
      ]);
      expect([200, 404]).toContain(put.status);
      expect(deleted.status).toBe(204);
      expect(await AddonAssignment.countDocuments({ ownerId: a.ownerId, turfId: t })).toBe(0);
    }
  }, 60_000);

  it('venue closure racing venue delete', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const v = (await seedVenue(a.ownerId, { slug: `v-${i}` })).id as string;
      const [created, deleted] = await Promise.all([
        api().post(`${root()}/closures`).set(...bearer(a.token)).send({ venueId: v, ...day }),
        api().delete(`${root()}/venues/${v}`).set(...bearer(a.token)),
      ]);
      expect([201, 404]).toContain(created.status);
      expect(deleted.status).toBe(204);
      expect(await Venue.exists({ ownerId: a.ownerId, _id: v })).toBeNull();
      expect(await Closure.countDocuments({ ownerId: a.ownerId, venueId: v })).toBe(0);
    }
  }, 60_000);

  it('venue assignment racing venue delete', async () => {
    const id = await addon();
    for (let i = 0; i < ROUNDS; i++) {
      const v = (await seedVenue(a.ownerId, { slug: `v-${i}` })).id as string;
      const [put, deleted] = await Promise.all([
        api().put(`${root()}/venues/${v}/addons/${id}`).set(...bearer(a.token)).send({ enabled: true }),
        api().delete(`${root()}/venues/${v}`).set(...bearer(a.token)),
      ]);
      expect([200, 404]).toContain(put.status);
      expect(deleted.status).toBe(204);
      expect(await AddonAssignment.countDocuments({ ownerId: a.ownerId, venueId: v, turfId: null })).toBe(0);
    }
  }, 60_000);
});
