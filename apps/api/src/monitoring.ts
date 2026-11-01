import * as Sentry from '@sentry/node';
import type { Config } from './config';

let enabled = false;

/** Starts Sentry when SENTRY_DSN is set; otherwise reportError stays a no-op. Call once at startup. */
export function initMonitoring(config: Config): void {
  enabled = Boolean(config.sentryDsn);
  if (!enabled) return;
  // Request bodies, cookies and headers carry passwords, OTPs and session tokens; send only the stack trace.
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
}

/** Sends an unexpected error to Sentry, tagged with the request id that the logs and `X-Request-Id` carry. */
export function reportError(err: unknown, requestId?: string): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (requestId) scope.setTag('request_id', requestId);
    Sentry.captureException(err);
  });
}
