import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
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
let ownerId: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  ownerId = (await seedOwner(ctx.services)).ownerId;
});

const get = (slug: string) => request(ctx.app).get(`/api/v1/venues/${encodeURIComponent(slug)}`);

describe('public venue page', () => {
  it('published venue returns public fields and active turfs only', async () => {
    const venue = await seedVenue(ownerId, { slug: 'green-turf', published: true, settings: { bookingWindowDays: 7 } });
    await seedTurf(ownerId, venue.id as string, { name: 'B court' });
    await seedTurf(ownerId, venue.id as string, { name: 'A court', active: false });
    const res = await get('green-turf');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.venue).sort()).toEqual(
      ['slug', 'name', 'address', 'city', 'country', 'currency', 'timezone', 'location', 'photos', 'amenities', 'turfs'].sort(),
    );
    expect(res.body.venue.location).toEqual({ lat: 23.81, lng: 90.41 });
    expect(res.body.venue.turfs).toHaveLength(1);
    expect(Object.keys(res.body.venue.turfs[0]).sort()).toEqual(['id', 'name', 'sports', 'indoor', 'slotLengthMin'].sort());
    expect(res.body.venue.turfs[0].name).toBe('B court');
  });

  it('unpublished, unknown and malformed slugs → identical 404', async () => {
    await seedVenue(ownerId, { slug: 'hidden-venue', published: false });
    const bodies = [];
    for (const slug of ['hidden-venue', 'no-such-venue', 'Bad Slug!']) {
      const res = await get(slug);
      expect(res.status, slug).toBe(404);
      bodies.push(res.body);
    }
    for (const body of bodies) expect(body).toEqual({ error: { code: 'not_found', message: 'Venue not found' } });
  });

  it('no auth needed', async () => {
    await seedVenue(ownerId, { slug: 'open-venue', published: true });
    const res = await get('open-venue');
    expect(res.status).toBe(200);
    expect(res.body.venue.turfs).toEqual([]);
  });
});
