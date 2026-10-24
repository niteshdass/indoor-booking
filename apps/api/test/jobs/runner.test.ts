import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { testConfig } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { JOBS, LEASE_MS, runDueJobs, startJobs, type Job } from '../../src/jobs/runner';
import { JobRun } from '../../src/jobs/jobRun.model';

beforeAll(startTestDb);
afterAll(stopTestDb);

let services = makeTestServices();
let deps = { config: testConfig, services };
const counts: Record<string, number> = {};

function stub(name: string, everyMs: number, fail = false): Job {
  return {
    name,
    everyMs,
    async run() {
      counts[name] = (counts[name] ?? 0) + 1;
      if (fail) throw new Error('boom');
    },
  };
}

beforeEach(async () => {
  services = makeTestServices();
  deps = { config: testConfig, services };
  for (const k of Object.keys(counts)) delete counts[k];
  await JobRun.deleteMany({});
});
afterEach(() => vi.restoreAllMocks());

describe('runDueJobs', () => {
  it('a due job runs once and not again before its interval', async () => {
    const jobs = [stub('a', 60_000)];
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual(['a']);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual([]);
    services.clock.advance(59_000);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual([]);
    services.clock.advance(1_000);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual(['a']);
    expect(counts.a).toBe(2);
  });

  it('two holders ticking at once run each job once', async () => {
    const jobs = [stub('a', 60_000), stub('b', 60_000)];
    await Promise.all([runDueJobs(jobs, deps, 'a'), runDueJobs(jobs, deps, 'b')]);
    expect(counts).toEqual({ a: 1, b: 1 });
  });

  it('a throwing job is logged, others still run, and its lease is released', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const jobs = [stub('bad', 1_000, true), stub('good', 1_000)];
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual(['bad', 'good']);
    expect(counts).toEqual({ bad: 1, good: 1 });
    expect(err).toHaveBeenCalledWith('[jobs] bad failed', expect.any(Error));
    const run = await JobRun.findById('bad');
    expect(run?.leaseUntil.getTime()).toBe(services.now().getTime());
    services.clock.advance(1_000);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual(['bad', 'good']);
  });

  it('a lease left by a crashed holder is taken once it lapses', async () => {
    const now = services.now();
    await JobRun.create({
      _id: 'a',
      holder: 'dead',
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      lastStartedAt: new Date(now.getTime() - 3_600_000),
    });
    const jobs = [stub('a', 60_000)];
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual([]);
    services.clock.advance(LEASE_MS - 1);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual([]);
    services.clock.advance(1);
    expect(await runDueJobs(jobs, deps, 'h1')).toEqual(['a']);
    expect(counts.a).toBe(1);
  });
});

describe('startJobs', () => {
  it('startJobs ticks until stopped', async () => {
    const jobs = [stub('a', 0)];
    const handle = startJobs(deps, { tickMs: 10, jobs });
    await vi.waitFor(() => expect(counts.a).toBeGreaterThanOrEqual(2));
    await handle.stop();
    const after = counts.a;
    await new Promise((r) => setTimeout(r, 60));
    expect(counts.a).toBe(after);
  });
});

describe('JOBS', () => {
  it('JOBS registers every sweep, delivery and refund reconcile', () => {
    expect(JOBS.map((j) => [j.name, j.everyMs])).toEqual([
      ['expire-holds', 30_000],
      ['auto-reject', 60_000],
      ['auto-complete', 300_000],
      ['reminders', 60_000],
      ['hold-warnings', 60_000],
      ['deliver-notifications', 15_000],
      ['reconcile-refunds', 300_000],
    ]);
  });
});
