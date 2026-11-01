import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config';

/** An id a proxy or the client already set is kept when it looks like one; anything else is replaced. */
const SANE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SANE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/**
 * One JSON log line per request, carrying the request id that is also sent back as `X-Request-Id`,
 * so a user's report can be matched to the log. Silent under tests; credentials are redacted.
 */
export function requestLogger(config: Config) {
  const logger = pino({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  });
  return pinoHttp({
    logger,
    genReqId: requestId,
    // Uptime pingers hit these every minute; logging them would bury real traffic.
    autoLogging: { ignore: (req) => /\/(health|jobs\/tick)$/.test(req.url?.split('?')[0] ?? '') },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  });
}
