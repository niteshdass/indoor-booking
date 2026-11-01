import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { errorHandler } from '../../src/errors';
import { JobRun } from '../../src/jobs/jobRun.model';
import { cronAuthorized, jobsTickRouter } from '../../src/jobs/tick';
import { loadConfig } from '../../src/config';

const SECRET = 's'.repeat(32);

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(() => JobRun.deleteMany({}));

describe('cronAuthorized', () => {
  it('accepts only the exact bearer secret', () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAuthorized(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(cronAuthorized(SECRET, SECRET)).toBe(false);
    expect(cronAuthorized(undefined, SECRET)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
    expect(cronAuthorized('Bearer undefined', undefined)).toBe(false);
  });
});

describe('GET /jobs/tick', () => {
  function tickApp(run = vi.fn(async () => 0)) {
    const app = express();
    const deps = { config: testConfig, services: makeTestServices(), cronSecret: SECRET };
    app.use(jobsTickRouter(deps, [{ name: 'probe', everyMs: 60_000, run }]));
    app.use(errorHandler);
    return { app, run };
  }

  it('runs the due jobs for the right secret, and not again before they are due', async () => {
    const { app, run } = tickApp();
    const res = await request(app).get('/jobs/tick').set('Authorization', `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ran: ['probe'] });
    const again = await request(app).get('/jobs/tick').set('Authorization', `Bearer ${SECRET}`);
    expect(again.body).toEqual({ ran: [] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('401s a missing or wrong secret without running anything', async () => {
    const { app, run } = tickApp();
    expect((await request(app).get('/jobs/tick')).status).toBe(401);
    expect((await request(app).get('/jobs/tick').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('is mounted on the API only when CRON_SECRET is set', async () => {
    const off = buildTestApp();
    expect((await request(off.app).get('/api/v1/jobs/tick').set('Authorization', `Bearer ${SECRET}`)).status).toBe(404);
    const on = buildTestApp({ config: { cronSecret: SECRET } });
    expect((await request(on.app).get('/api/v1/jobs/tick')).status).toBe(401);
  });

  it('config refuses a short secret', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 'x'.repeat(32) };
    expect(() => loadConfig({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
    expect(loadConfig({ ...base, CRON_SECRET: SECRET }).cronSecret).toBe(SECRET);
  });
});
