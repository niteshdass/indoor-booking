import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
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
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { AddonAssignment } from '../../src/addons/assignment.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
    Closure.init(), SlotOverride.init(), AddonAssignment.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
beforeEach(async () => {
  const any = { crossTenant: true };
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions(any),
    Venue.deleteMany({}).setOptions(any),
    Turf.deleteMany({}).setOptions(any),
    Closure.deleteMany({}).setOptions(any),
    SlotOverride.deleteMany({}).setOptions(any),
    AddonAssignment.deleteMany({}).setOptions(any),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
});

const api = () => request(ctx.app);
const url = (venueId: string, turfId?: string) =>
  `/api/v1/owners/${a.ownerId}/venues/${venueId}${turfId ? `/turfs/${turfId}` : ''}`;

/** One override, turf closure and turf assignment for a turf. */
async function seedTurfRows(venueId: string, turfId: string) {
  await SlotOverride.create({ ownerId: a.ownerId, venueId, turfId, date: '2026-11-02', type: 'close' });
  await Closure.create({ ownerId: a.ownerId, venueId, turfId, from: '2026-11-02', to: '2026-11-03' });
  await AddonAssignment.create({
    ownerId: a.ownerId, addonId: new mongoose.Types.ObjectId(), venueId, turfId, enabled: true,
  });
}
async function seedVenueRows(venueId: string) {
  await Closure.create({ ownerId: a.ownerId, venueId, turfId: null, from: '2026-11-02', to: '2026-11-03' });
  await AddonAssignment.create({
    ownerId: a.ownerId, addonId: new mongoose.Types.ObjectId(), venueId, turfId: null, enabled: true,
  });
}
const counts = async (filter: Record<string, unknown>) => ({
  overrides: await SlotOverride.countDocuments({ ownerId: a.ownerId, ...filter }),
  closures: await Closure.countDocuments({ ownerId: a.ownerId, ...filter }),
  assignments: await AddonAssignment.countDocuments({ ownerId: a.ownerId, ...filter }),
});

describe('delete cascades', () => {
  it('turf delete removes its schedule and add-on rows', async () => {
    const v = (await seedVenue(a.ownerId, { slug: 'v-one', published: true })).id as string;
    const t1 = (await seedTurf(a.ownerId, v)).id as string;
    const t2 = (await seedTurf(a.ownerId, v)).id as string;
    await seedTurfRows(v, t1);
    await seedTurfRows(v, t2);
    await seedVenueRows(v);
    await Closure.create({ ownerId: a.ownerId, venueId: null, turfId: null, from: '2026-11-02', to: '2026-11-03' });

    const res = await api().delete(url(v, t1)).set(...bearer(a.token));
    expect(res.status).toBe(204);

    expect(await counts({ turfId: t1 })).toEqual({ overrides: 0, closures: 0, assignments: 0 });
    expect(await counts({ turfId: t2 })).toEqual({ overrides: 1, closures: 1, assignments: 1 });
    expect(await Closure.countDocuments({ ownerId: a.ownerId, venueId: v, turfId: null })).toBe(1);
    expect(await AddonAssignment.countDocuments({ ownerId: a.ownerId, venueId: v, turfId: null })).toBe(1);
    expect(await Closure.countDocuments({ ownerId: a.ownerId, venueId: null })).toBe(1);
  });

  it('venue delete removes its venue-level rows', async () => {
    const v1 = (await seedVenue(a.ownerId, { slug: 'v-one' })).id as string;
    const v2 = (await seedVenue(a.ownerId, { slug: 'v-two' })).id as string;
    const t = (await seedTurf(a.ownerId, v2)).id as string;
    await seedVenueRows(v1);
    await seedVenueRows(v2);
    await seedTurfRows(v2, t);
    await Closure.create({ ownerId: a.ownerId, venueId: null, turfId: null, from: '2026-11-02', to: '2026-11-03' });

    const res = await api().delete(url(v1)).set(...bearer(a.token));
    expect(res.status).toBe(204);

    expect(await counts({ venueId: v1 })).toEqual({ overrides: 0, closures: 0, assignments: 0 });
    expect(await counts({ venueId: v2 })).toEqual({ overrides: 1, closures: 2, assignments: 2 });
    expect(await Closure.countDocuments({ ownerId: a.ownerId, venueId: null })).toBe(1);
  });

  it('blocked turf delete changes nothing', async () => {
    const v = (await seedVenue(a.ownerId, { slug: 'v-one', published: true })).id as string;
    const t = (await seedTurf(a.ownerId, v)).id as string;
    await seedTurfRows(v, t);

    const res = await api().delete(url(v, t)).set(...bearer(a.token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_active_turf');
    expect(await counts({ turfId: t })).toEqual({ overrides: 1, closures: 1, assignments: 1 });
  });
});
