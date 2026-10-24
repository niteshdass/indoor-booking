import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { SearchResult } from '@booking/shared';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
import { seedTurf, seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Venue } from '../../src/venues/venue.model';
import { Turf } from '../../src/venues/turf.model';

const flight = vi.hoisted(() => ({ now: 0, max: 0 }));

// Counts loadDay calls in flight at once; each waits a little so overlap is observable.
vi.mock('../../src/schedule/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/schedule/load')>();
  return {
    ...actual,
    loadDay: async (...args: Parameters<typeof actual.loadDay>) => {
      flight.now++;
      flight.max = Math.max(flight.max, flight.now);
      try {
        await new Promise((r) => setTimeout(r, 10));
        return await actual.loadDay(...args);
      } finally {
        flight.now--;
      }
    },
  };
});

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Venue.init(), Turf.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
    Turf.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp();
  ownerId = (await seedOwner(ctx.services)).ownerId;
  flight.max = 0;
});

describe('search concurrency', () => {
  it('loads several venues at once and keeps their order', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (const name of names) {
      const venue = await seedVenue(ownerId, { name, published: true });
      await seedTurf(ownerId, venue.id as string, { pricing: { base: 1000, rules: [] } });
    }
    const res = await request(ctx.app).get('/api/v1/search').query({ limit: '4' });
    expect((res.body.results as SearchResult[]).map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(res.body.nextCursor).toBe(4);
    expect(flight.max).toBeGreaterThan(1);
  });
});
