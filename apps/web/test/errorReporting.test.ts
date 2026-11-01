import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const init = vi.fn();
const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ init, captureException }));

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
  captureException.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('error reporting', () => {
  it('does nothing without VITE_SENTRY_DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initErrorReporting, reportError } = await import('../src/lib/errorReporting');
    await initErrorReporting();
    await reportError(new Error('boom'));
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('initialises once and sends errors with the component stack when the DSN is set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');
    const { initErrorReporting, reportError } = await import('../src/lib/errorReporting');
    await initErrorReporting();
    const error = new Error('boom');
    await reportError(error, '\n    at Boom');
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://key@o0.ingest.sentry.io/1' }));
    expect(captureException).toHaveBeenCalledWith(error, { contexts: { react: { componentStack: '\n    at Boom' } } });
  });
});
