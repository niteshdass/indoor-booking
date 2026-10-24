import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { TurfPricing } from '@booking/shared';
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

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), ActivityLog.init(), Venue.init(), Turf.init(),
  ]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let v1: string;
let t1: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    ActivityLog.deleteMany({}).setOptions({ crossTenant: true }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  a = await seedOwner(ctx.services);
  v1 = (await seedVenue(a.ownerId)).id as string;
  t1 = (await seedTurf(a.ownerId, v1)).id as string;
});

const api = () => request(ctx.app);
const url = (venueId = v1, turfId = t1, ownerId = a.ownerId) =>
  `/api/v1/owners/${ownerId}/venues/${venueId}/turfs/${turfId}`;
const put = (body: unknown, token = a.token, venueId = v1, turfId = t1) =>
  api().put(`${url(venueId, turfId)}/pricing`).set(...bearer(token)).send(body as object);

const fixture: TurfPricing = {
  base: 1000,
  rules: [
    { kind: 'weekday', range: { start: '18:00', end: '22:00' }, price: 1400 },
    { kind: 'weekday', range: { start: '22:00', end: '02:00' }, price: 1200 },
    { kind: 'weekend', price: 1500 },
    { kind: 'date', date: '2026-12-16', range: { start: '16:00', end: '20:00' }, price: 2000 },
  ],
};

describe('turf pricing', () => {
  it('sets pricing and shows it on the turf', async () => {
    expect((await api().get(url()).set(...bearer(a.token))).body.turf.pricing).toBeNull();
    const res = await put(fixture);
    expect(res.status).toBe(200);
    expect(res.body.pricing).toEqual(fixture);
    const got = await api().get(url()).set(...bearer(a.token));
    expect(got.body.turf.pricing).toEqual(fixture);
    const row = await ActivityLog.findOne({ ownerId: a.ownerId, action: 'pricing.update' }).lean();
    expect(row).toMatchObject({ entity: 'turf', after: { pricing: fixture } });
    expect(String(row!.entityId)).toBe(t1);
  });

  it('rejects bad pricing', async () => {
    const bad = [
      { ...fixture, base: 10.5 },
      { base: 1000, rules: [{ kind: 'weekend', price: -1 }] },
      { base: 1000, rules: [{ kind: 'date', date: '2026-02-30', price: 1 }] },
      { base: 1000, rules: [{ kind: 'weekend', range: { start: '25:00', end: '02:00' }, price: 1 }] },
      { base: 1000, rules: [{ kind: 'weekend', price: 1, extra: 1 }] },
      {
        base: 1000,
        rules: [
          { kind: 'weekday', range: { start: '10:00', end: '14:00' }, price: 1 },
          { kind: 'weekday', range: { start: '13:00', end: '16:00' }, price: 2 },
        ],
      },
      { base: 1000, rules: Array.from({ length: 101 }, (_, i) => ({ kind: 'date', date: '2026-12-01', range: { start: '00:00', end: '00:01' }, price: i })) },
    ];
    for (const body of bad) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
    }
    const overlap = await put(bad[5]);
    expect(JSON.stringify(overlap.body.error.details)).toContain('Rules 0 and 1 overlap');
    expect((await Turf.findOne({ ownerId: a.ownerId, _id: t1 }).lean())!.pricing).toBeNull();
  });

  it('needs pricing.edit', async () => {
    const staff = await addMember(ctx.services, a.ownerId);
    const res = await put(fixture, staff.token);
    expect(res.status).toBe(403);
  });

  it('other owner or out-of-scope venue → 404', async () => {
    const b = await seedOwner(ctx.services);
    const bVenue = (await seedVenue(b.ownerId)).id as string;
    const bTurf = (await seedTurf(b.ownerId, bVenue)).id as string;
    const foreign = await put(fixture, a.token, bVenue, bTurf);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.message).toBe('Venue not found');

    const v2 = (await seedVenue(a.ownerId)).id as string;
    const t2 = (await seedTurf(a.ownerId, v2)).id as string;
    const m = await addMember(ctx.services, a.ownerId, { roleKey: 'manager', venueIds: [v1] });
    expect((await put(fixture, m.token, v2, t2)).status).toBe(404);
    expect((await put(fixture, m.token, v1, t1)).status).toBe(200);

    const wrong = await put(fixture, a.token, v1, t2);
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.message).toBe('Turf not found');
  });
});
