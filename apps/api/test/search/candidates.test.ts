import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';
import { parseSearchQuery } from '../../src/search/query';
import { findCandidates } from '../../src/search/candidates';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init()]);
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

const HERE = { lat: '23.81', lng: '90.41' };

/** A published venue with one active football turf. */
async function listed(name: string, over: Parameters<typeof seedVenue>[1] = {}, owner = ownerId) {
  const venue = await seedVenue(owner, { name, published: true, ...over });
  await seedTurf(owner, venue.id as string, { name: `${name} court` });
  return venue;
}

const names = (cs: Awaited<ReturnType<typeof findCandidates>>) => cs.map((c) => c.venue.name);

describe('findCandidates', () => {
  it('a map box keeps only venues inside it, with or without a location', async () => {
    await listed('Dhaka', { location: [90.41, 23.81] });
    await listed('Chattogram', { location: [91.83, 22.35] });
    await listed('Sylhet', { location: [91.87, 24.9] });

    const dhaka = { bbox: '90.2,23.6,90.6,24' };
    expect(names(await findCandidates(parseSearchQuery(dhaka), 0, 10))).toEqual(['Dhaka']);
    expect(names(await findCandidates(parseSearchQuery({ ...dhaka, ...HERE }), 0, 10))).toEqual(['Dhaka']);
    const east = await findCandidates(parseSearchQuery({ bbox: '91,22,92.5,25.5' }), 0, 10);
    expect(names(east)).toEqual(['Chattogram', 'Sylhet']);
  });

  it('a map box across the antimeridian wraps', async () => {
    await listed('Fiji', { location: [178.44, -18.14] });
    await listed('Samoa', { location: [-171.76, -13.83] });
    await listed('Dhaka', { location: [90.41, 23.81] });
    const res = await findCandidates(parseSearchQuery({ bbox: '170,-25,-165,-5' }), 0, 10);
    expect(names(res)).toEqual(['Fiji', 'Samoa']);
  });

  it('sorted by distance; radius excludes farther venues', async () => {
    await listed('Far', { location: [90.41, 23.81 + 0.225] });
    await listed('Here');
    await listed('Mid', { location: [90.41, 23.81 + 0.135] });

    const all = await findCandidates(parseSearchQuery(HERE), 0, 10);
    expect(names(all)).toEqual(['Here', 'Mid', 'Far']);
    expect(all[0]?.distanceMeters).toBe(0);
    expect(all[1]?.distanceMeters).toBeGreaterThan(14_500);
    expect(all[1]?.distanceMeters).toBeLessThan(15_500);
    expect(Number.isInteger(all[1]?.distanceMeters)).toBe(true);

    const near = await findCandidates(parseSearchQuery({ ...HERE, radiusKm: '20' }), 0, 10);
    expect(names(near)).toEqual(['Here', 'Mid']);
  });

  it('without a location: name order, distance null', async () => {
    await listed('Bravo');
    await listed('Alpha', { location: [0, 0] });
    const cs = await findCandidates(parseSearchQuery({}), 0, 10);
    expect(names(cs)).toEqual(['Alpha', 'Bravo']);
    expect(cs.map((c) => c.distanceMeters)).toEqual([null, null]);
  });

  it('only published venues of active owners with an active matching turf', async () => {
    const match = await seedVenue(ownerId, { name: 'Match', published: true });
    await seedTurf(ownerId, match.id as string, { name: 'B indoor futsal', sports: ['futsal', 'football'], indoor: true });
    await seedTurf(ownerId, match.id as string, { name: 'A indoor futsal', sports: ['futsal'], indoor: true });
    await seedTurf(ownerId, match.id as string, { name: 'Outdoor futsal', sports: ['futsal'], indoor: false });
    await seedTurf(ownerId, match.id as string, { name: 'Indoor cricket', sports: ['cricket'], indoor: true });

    const hidden = await seedVenue(ownerId, { name: 'Hidden', published: false });
    await seedTurf(ownerId, hidden.id as string, { sports: ['futsal'], indoor: true });
    const inactive = await seedVenue(ownerId, { name: 'Inactive', published: true });
    await seedTurf(ownerId, inactive.id as string, { sports: ['futsal'], indoor: true, active: false });
    const wrongSport = await seedVenue(ownerId, { name: 'Wrong sport', published: true });
    await seedTurf(ownerId, wrongSport.id as string, { sports: ['football'], indoor: true });
    const outdoor = await seedVenue(ownerId, { name: 'Outdoor', published: true });
    await seedTurf(ownerId, outdoor.id as string, { sports: ['futsal'], indoor: false });

    const suspended = (await seedOwner(ctx.services)).ownerId;
    await Owner.updateOne({ _id: suspended }, { status: 'suspended' });
    const susVenue = await seedVenue(suspended, { name: 'Suspended', published: true });
    await seedTurf(suspended, susVenue.id as string, { sports: ['futsal'], indoor: true });

    const cs = await findCandidates(parseSearchQuery({ sport: 'futsal', indoor: 'true' }), 0, 10);
    expect(names(cs)).toEqual(['Match']);
    expect(cs[0]?.turfs.map((t) => t.name)).toEqual(['A indoor futsal', 'B indoor futsal']);
    expect(cs[0]?.turfs[0]).toBeInstanceOf(Turf);
    expect(cs[0]?.venue).toBeInstanceOf(Venue);
  });

  it('currency filter keeps only that currency', async () => {
    await listed('Taka');
    await listed('Dollar', { currency: 'USD' });
    const cs = await findCandidates(parseSearchQuery({ ...HERE, currency: 'USD' }), 0, 10);
    expect(names(cs)).toEqual(['Dollar']);
  });

  it("two owners' venues both come back", async () => {
    const other = (await seedOwner(ctx.services)).ownerId;
    await listed('Mine');
    await listed('Theirs', {}, other);
    const cs = await findCandidates(parseSearchQuery({}), 0, 10);
    expect(names(cs)).toEqual(['Mine', 'Theirs']);
  });

  it('skip and n page stably through equal distances', async () => {
    await listed('One');
    await listed('Two');
    await listed('Three');
    const q = parseSearchQuery(HERE);
    const pages = await Promise.all([0, 1, 2, 3].map((i) => findCandidates(q, i, 1)));
    const ids = pages.slice(0, 3).map((p) => p[0]?.venue.id as string);
    expect(new Set(ids).size).toBe(3);
    expect(pages[3]).toEqual([]);
  });
});
