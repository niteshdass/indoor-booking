import os from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { AppServices } from '../services';
import { deliverNotifications } from '../notifications/outbox';
import { sweepPendingImages } from '../images/attach';
import { reconcileRefunds } from '../payments/refunds';
import { JobRun } from './jobRun.model';
import { autoCompleteBookings, autoDeclineSeries, autoRejectPending, endSeries, expireHolds, sendReminders, sendReviewRequests, warnExpiringHolds } from './sweeps';

export type JobDeps = { config: Config; services: AppServices };
export type Job = { name: string; everyMs: number; run(now: Date, deps: JobDeps): Promise<unknown> };

/** How long a holder owns a job; a crashed holder's lease lapses after this. */
export const LEASE_MS = 5 * 60_000;
const DEFAULT_TICK_MS = 15_000;
const DUPLICATE_KEY = 11000;

export const JOBS: Job[] = [
  { name: 'expire-holds', everyMs: 30_000, run: (now) => expireHolds(now) },
  { name: 'auto-reject', everyMs: 60_000, run: (now) => autoRejectPending(now) },
  { name: 'auto-complete', everyMs: 300_000, run: (now) => autoCompleteBookings(now) },
  { name: 'reminders', everyMs: 60_000, run: (now) => sendReminders(now) },
  { name: 'hold-warnings', everyMs: 60_000, run: (now) => warnExpiringHolds(now) },
  { name: 'review-requests', everyMs: 300_000, run: (now) => sendReviewRequests(now) },
  { name: 'series-auto-decline', everyMs: 60_000, run: (now) => autoDeclineSeries(now) },
  { name: 'series-end', everyMs: 300_000, run: (now) => endSeries(now) },
  { name: 'deliver-notifications', everyMs: 15_000, run: (now, deps) => deliverNotifications(now, deps) },
  { name: 'reconcile-refunds', everyMs: 300_000, run: (now, deps) => reconcileRefunds(now, deps) },
  { name: 'pending-images', everyMs: 3_600_000, run: (now) => sweepPendingImages(now) },
];

/** Takes the job's lease if it is free and due; false when another holder has it or its interval has not elapsed. */
async function acquire(job: Job, holder: string, now: Date): Promise<boolean> {
  try {
    await JobRun.findOneAndUpdate(
      { _id: job.name, leaseUntil: { $lte: now }, lastStartedAt: { $lte: new Date(now.getTime() - job.everyMs) } },
      { $set: { holder, leaseUntil: new Date(now.getTime() + LEASE_MS), lastStartedAt: now } },
      { upsert: true, new: true },
    );
    return true;
  } catch (err) {
    // The filter missed an existing row, so the upsert tried to insert its _id again.
    if ((err as { code?: number }).code === DUPLICATE_KEY) return false;
    console.error(`[jobs] ${job.name} acquire failed`, err);
    return false;
  }
}

/** Runs each job that is due and not leased by another holder; returns the names it ran. */
export async function runDueJobs(jobs: Job[], deps: JobDeps, holder: string): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    const now = deps.services.now();
    if (!(await acquire(job, holder, now))) continue;
    ran.push(job.name);
    try {
      await job.run(now, deps);
    } catch (err) {
      console.error(`[jobs] ${job.name} failed`, err);
    }
    try {
      // Frees the lease early; lastStartedAt still spaces the next run.
      await JobRun.updateOne({ _id: job.name, holder }, { $set: { leaseUntil: now } });
    } catch (err) {
      console.error(`[jobs] ${job.name} release failed`, err);
    }
  }
  return ran;
}

/** Ticks runDueJobs until stopped; ticks never overlap, and stop() waits for the one in flight. */
export function startJobs(deps: JobDeps, opts: { tickMs?: number; jobs?: Job[] } = {}): { stop(): Promise<void> } {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  const jobs = opts.jobs ?? JOBS;
  const holder = `${os.hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (!stopped) timer = setTimeout(tick, tickMs);
  };
  const tick = () => {
    inFlight = runDueJobs(jobs, deps, holder)
      .then(() => undefined)
      .catch((err) => console.error('[jobs] tick failed', err))
      .finally(schedule);
  };
  schedule();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
