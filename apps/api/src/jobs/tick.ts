import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { AppError } from '../errors';
import { JOBS, runDueJobs, type Job, type JobDeps } from './runner';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Whether `authorization` is `Bearer <secret>`. Compares fixed-length digests in constant time, so
 * neither the secret's characters nor its length leak through response timing.
 */
export function cronAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

/**
 * `GET /jobs/tick`: runs whatever jobs are due, for hosts where no process stays up between requests.
 * Vercel Cron or an outside pinger calls it every 1-5 minutes with `Authorization: Bearer $CRON_SECRET`;
 * job leases keep overlapping ticks from running a job twice.
 */
export function jobsTickRouter(deps: JobDeps & { cronSecret: string }, jobs: Job[] = JOBS): Router {
  const router = Router();
  router.get('/jobs/tick', async (req, res) => {
    if (!cronAuthorized(req.get('authorization'), deps.cronSecret)) {
      throw new AppError(401, 'unauthorized', 'Missing or wrong cron secret');
    }
    const ran = await runDueJobs(jobs, deps, `tick:${randomBytes(4).toString('hex')}`);
    res.json({ ran });
  });
  return router;
}
