import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (scope: { setTag: (k: string, v: string) => void }) => void) =>
    fn({ setTag: sentry.setTag }),
  ),
  setTag: vi.fn(),
}));
vi.mock('@sentry/node', () => sentry);

const { initMonitoring } = await import('../src/monitoring');
const { errorHandler, AppError } = await import('../src/errors');
const { requestLogger } = await import('../src/requestLog');
const { testConfig } = await import('./helpers/testApp');
const { loadConfig } = await import('../src/config');

function crashApp() {
  const app = express();
  app.use(requestLogger(testConfig));
  app.get('/crash', () => {
    throw new Error('boom');
  });
  app.get('/conflict', () => {
    throw new AppError(409, 'slot_taken', 'Slot taken');
  });
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('monitoring', () => {
  it('does nothing without SENTRY_DSN', async () => {
    initMonitoring(testConfig);
    expect(sentry.init).not.toHaveBeenCalled();
    expect((await request(crashApp()).get('/crash')).status).toBe(500);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports unexpected errors, tagged with the request id, but not client errors', async () => {
    initMonitoring({ ...testConfig, sentryDsn: 'https://key@o1.ingest.sentry.io/1' });
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@o1.ingest.sentry.io/1',
        environment: 'test',
        dataCollection: expect.objectContaining({
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
        }),
      }),
    );

    const res = await request(crashApp()).get('/crash').set('X-Request-Id', 'req-1');
    expect(res.status).toBe(500);
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
    );
    expect(sentry.setTag).toHaveBeenCalledWith('request_id', 'req-1');

    expect((await request(crashApp()).get('/conflict')).status).toBe(409);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('reads SENTRY_DSN from the env', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 'x'.repeat(32) };
    expect(loadConfig(base).sentryDsn).toBeUndefined();
    expect(loadConfig({ ...base, SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' }).sentryDsn).toBe(
      'https://k@o1.ingest.sentry.io/1',
    );
    expect(() => loadConfig({ ...base, SENTRY_DSN: 'not a url' })).toThrow(/SENTRY_DSN/);
  });
});
