import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { SearchResult } from '@booking/shared';
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
import { Closure } from '../../src/schedule/closure.model';
import { SlotOverride } from '../../src/schedule/slotOverride.model';
import { Booking } from '../../src/bookings/booking.model';
import { searchConfig } from '../../src/search/routes';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([
    User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init(), Turf.init(),
    Closure.init(), SlotOverride.init(), Booking.init(),
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
    Closure.deleteMany({}).setOptions({ crossTenant: true }),
    SlotOverride.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  ownerId = (await seedOwner(ctx.services)).ownerId;
});

const scanBatch = searchConfig.scanBatch;
afterEach(() => {
  searchConfig.scanBatch = scanBatch;
});

const TODAY = '2026-01-01';
const pricing = { base: 1000, rules: [] };

/** A published venue with one active turf priced at 1000. */
async function listed(name: string, over: Parameters<typeof seedVenue>[1] = {}, turf: Parameters<typeof seedTurf>[2] = {}) {
  const venue = await seedVenue(ownerId, { name, published: true, ...over });
  const court = await seedTurf(ownerId, venue.id as string, { name: `${name} court`, pricing, ...turf });
  return { venue, turf: court, venueId: venue.id as string, turfId: court.id as string };
}

const closeToday = (venueId: string) =>
  Closure.create({ ownerId, venueId, turfId: null, from: TODAY, to: TODAY, reason: 'Eid' });

const search = (q: Record<string, string> = {}) => request(ctx.app).get('/api/v1/search').query(q);
const results = (res: { body: { results: SearchResult[] } }) => res.body.results;

describe('GET /api/v1/search', () => {
  it('result shape: public fields only', async () => {
    await listed('Arena', { slug: 'arena' });
    const res = await search();
    expect(res.status).toBe(200);
    const [r] = results(res);
    expect(Object.keys(r ?? {}).sort()).toEqual(
      [
        'slug', 'name', 'address', 'city', 'country', 'currency', 'timezone', 'location', 'photo',
        'sports', 'distanceMeters', 'date', 'fromPrice', 'nextFreeSlot',
      ].sort(),
    );
    expect(r).toMatchObject({
      slug: 'arena',
      location: { lat: 23.81, lng: 90.41 },
      photo: null,
      sports: ['football'],
      distanceMeters: null,
      date: TODAY,
      fromPrice: 1000,
    });
    expect(r?.nextFreeSlot?.localStart).toBe('08:00');
    expect(res.body.nextCursor).toBeNull();
  });

  it('fromPrice and nextFreeSlot follow blocks and peak prices', async () => {
    const { venueId, turfId } = await listed('Arena', {}, {
      pricing: { base: 1000, rules: [{ kind: 'weekday', range: { start: '08:00', end: '09:00' }, price: 800 }] },
    });
    await SlotOverride.create({ ownerId, venueId, turfId, date: TODAY, type: 'block', start: '08:00', end: '09:00' });
    const [r] = results(await search());
    expect(r?.nextFreeSlot?.localStart).toBe('09:00');
    expect(r?.fromPrice).toBe(1000);
  });

  it('available=true drops venues with no free slot', async () => {
    await listed('Open');
    const { venueId } = await listed('Shut');
    await closeToday(venueId);

    const all = results(await search());
    expect(all.map((r) => r.name)).toEqual(['Open', 'Shut']);
    expect(all[1]).toMatchObject({ fromPrice: null, nextFreeSlot: null });

    expect(results(await search({ available: 'true' })).map((r) => r.name)).toEqual(['Open']);
  });

  it("date defaults to each venue's local today", async () => {
    await listed('Dhaka');
    await listed('LA', { timezone: 'America/Los_Angeles', currency: 'USD' });
    const byName = Object.fromEntries(results(await search()).map((r) => [r.name, r.date]));
    expect(byName).toEqual({ Dhaka: '2026-01-01', LA: '2025-12-31' });
  });

  it('date outside the booking window has no slots', async () => {
    await listed('Arena', { settings: { bookingWindowDays: 7 } });
    const [r] = results(await search({ date: '2026-01-20' }));
    expect(r).toMatchObject({ date: '2026-01-20', fromPrice: null, nextFreeSlot: null });
    expect(results(await search({ date: '2026-01-20', available: 'true' }))).toEqual([]);
  });

  it('night session slot after midnight is found on its business day', async () => {
    await listed('Night', { settings: { hours: { thu: { open: '16:00', close: '02:00' } } } });
    const [r] = results(await search({ date: TODAY, from: '00:00', to: '02:00' }));
    expect(r?.nextFreeSlot).toMatchObject({ localStart: '00:00', startAt: '2026-01-01T18:00:00.000Z' });
  });

  it('limit 1 walks every venue once', async () => {
    await listed('A');
    await listed('B');
    await listed('C');
    const slugs: string[] = [];
    let cursor: number | null = 0;
    while (cursor !== null) {
      const res = await search({ limit: '1', cursor: String(cursor) });
      slugs.push(...results(res).map((r) => r.slug));
      cursor = res.body.nextCursor;
    }
    expect(new Set(slugs).size).toBe(3);
    expect(slugs).toHaveLength(3);
  });

  it('filtered-out venues still advance the cursor', async () => {
    searchConfig.scanBatch = 2;
    await listed('A');
    const { venueId } = await listed('B');
    await closeToday(venueId);
    await listed('C');

    const first = await search({ available: 'true', limit: '5' });
    expect(results(first).map((r) => r.name)).toEqual(['A']);
    expect(first.body.nextCursor).toBe(2);

    const second = await search({ available: 'true', limit: '5', cursor: '2' });
    expect(results(second).map((r) => r.name)).toEqual(['C']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('bad query → 400 validation_error', async () => {
    const res = await search({ radiusKm: '10' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('unpublished venue never appears', async () => {
    await listed('Public');
    await listed('Draft', { published: false });
    expect(results(await search()).map((r) => r.name)).toEqual(['Public']);
  });
});
