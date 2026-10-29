import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from './helpers/testDb';
import { buildTestApp } from './helpers/testApp';
import { createApp } from '../src/app';
import { dbState } from '../src/db';
import { MongoRateLimitStore, RateLimitHit } from '../src/rateLimitStore';

beforeAll(async () => {
  await startTestDb();
  await RateLimitHit.init();
});
afterAll(stopTestDb);
beforeEach(() => RateLimitHit.deleteMany({}));

describe('MongoRateLimitStore', () => {
  it('counts up within a window and starts again once it lapses', async () => {
    const store = new MongoRateLimitStore('t');
    store.windowMs = 1000;
    expect((await store.increment('k')).totalHits).toBe(1);
    expect((await store.increment('k')).totalHits).toBe(2);
    await store.decrement('k');
    expect((await store.get('k'))?.totalHits).toBe(1);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await store.get('k')).toBeUndefined();
    expect((await store.increment('k')).totalHits).toBe(1);
    await store.resetKey('k');
    expect(await store.get('k')).toBeUndefined();
  });

  it('concurrent increments are all counted', async () => {
    const store = new MongoRateLimitStore('t');
    const out = await Promise.all(Array.from({ length: 20 }, () => store.increment('k')));
    expect(out.map((o) => o.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('two app instances (two servers) share one bucket', async () => {
    const { config, services } = buildTestApp();
    const servers = [0, 1].map(() => createApp({ config, dbState, services, rateLimit: true, sharedRateLimits: true }));
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(servers[i % 2]!).post('/api/v1/bookings/lookup').send({ reference: 'ZZ', phone: '+8801711111111' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
