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
};

export function buildTestApp(
  opts: {
    services?: TestServices;
    rateLimit?: boolean;
    extraRoutes?: (router: express.Router) => void;
  } = {},
): { app: express.Express; services: TestServices; config: Config } {
  const services = opts.services ?? makeTestServices();
  const app = createApp({
    config: testConfig,
    dbState,
    services,
    rateLimit: opts.rateLimit,
    extraRoutes: opts.extraRoutes,
  });
  return { app, services, config: testConfig };
}
