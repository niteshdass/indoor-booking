import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { createApp } from './app';
import { loadConfig } from './config';
import { connectDb, dbState } from './db';
import { AppError, errorHandler } from './errors';
import { JOBS, runDueJobs } from './jobs/runner';
import { runMigrations } from './migrations';
import { defaultServices } from './services';
import { ensureSystemRoles } from './tenancy/role.model';

/**
 * Vercel function entry: the same app as server.ts, booted once per warm instance.
 * Functions don't stay alive between requests, so jobs run when something calls
 * GET /api/v1/jobs/tick with `Authorization: Bearer $CRON_SECRET` (Vercel Cron or an outside pinger).
 */
async function boot(): Promise<express.Express> {
  const config = loadConfig(process.env);
  await connectDb(config.mongodbUri);
  await ensureSystemRoles();
  const services = defaultServices(config);
  await runMigrations(services.now());

  const app = express();
  app.get('/api/v1/jobs/tick', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) {
      throw new AppError(401, 'unauthorized', 'Missing or wrong cron secret');
    }
    const ran = await runDueJobs(JOBS, { config, services }, `vercel:${randomBytes(4).toString('hex')}`);
    res.json({ ran });
  });
  app.use('/api/v1/jobs/tick', errorHandler);
  app.use(createApp({ config, dbState, services }));
  return app;
}

let ready: Promise<express.Express> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= boot();
    const app = await ready;
    app(req as express.Request, res as express.Response);
  } catch (err) {
    // Retry the boot on the next request instead of caching the failure.
    ready = undefined;
    console.error('[boot] failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'boot_failed', message: 'Server failed to start' } }));
  }
}
