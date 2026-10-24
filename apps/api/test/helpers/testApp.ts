import type express from 'express';
import { createApp } from '../../src/app';
import type { Config } from '../../src/config';
import { dbState } from '../../src/db';
import { makeTestServices, type TestServices } from './testServices';

export const testConfig: Config = {
  nodeEnv: 'test',
  port: 0,
  mongodbUri: 'mongodb://unused',
  corsOrigin: 'http://localhost:5173',
  jwtSecret: 'x'.repeat(32),
  appUrl: 'http://localhost:5173',
  apiUrl: 'http://localhost:4000',
  paymentsKey: Buffer.alloc(32, 7),
};

export function buildTestApp(
  opts: {
    services?: TestServices;
    config?: Partial<Config>;
    rateLimit?: boolean;
    extraRoutes?: (router: express.Router) => void;
  } = {},
): { app: express.Express; services: TestServices; config: Config } {
  const services = opts.services ?? makeTestServices();
  const config = { ...testConfig, ...opts.config };
  const app = createApp({
    config,
    dbState,
    services,
    rateLimit: opts.rateLimit,
    extraRoutes: opts.extraRoutes,
  });
  return { app, services, config };
}
