type Capture = typeof import('@sentry/react').captureException;

let sentry: Promise<Capture | null> | undefined;

/** Sentry loads in its own chunk, and only when VITE_SENTRY_DSN is set; without it every call is a no-op. */
function load(): Promise<Capture | null> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return Promise.resolve(null);
  // Destructured so the bundler keeps only what's used, not the whole SDK (replay, tracing…).
  sentry ??= import('@sentry/react').then(
    ({ init, captureException }) => {
      init({ dsn, environment: import.meta.env.MODE, sendDefaultPii: false });
      return captureException;
    },
    () => null,
  );
  return sentry;
}

/** Called once at startup so uncaught errors and rejections are reported too. */
export function initErrorReporting(): Promise<void> {
  return load().then(() => undefined);
}

export function reportError(error: unknown, componentStack?: string | null): Promise<void> {
  return load().then((capture) => {
    capture?.(error, componentStack ? { contexts: { react: { componentStack } } } : undefined);
  });
}
