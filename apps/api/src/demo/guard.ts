import type { RequestHandler } from 'express';
import { AppError } from '../errors';

/**
 * Writes a shared demo cannot allow, matched on the path under /api/v1. Reads stay open everywhere.
 * Keys and credentials: platform settings (Google, SMTP, Twilio, payout Stripe, fee) and owner payment gateways.
 * Shared accounts: anything that would lock the next visitor out of a demo button.
 */
const LOCKED: RegExp[] = [
  /^\/admin\/settings(\/|$)/,
  /^\/owners\/[^/]+\/payment-gateways(\/|$)/,
  /^\/admin\/users\/[^/]+\/(disable|enable)$/,
  /^\/admin\/owners\/[^/]+\/suspend$/,
  /^\/owners\/[^/]+\/members\/[^/]+$/,
  /^\/me$/,
  /^\/me\/(link|email)\//,
  /^\/auth\/password\//,
];

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const demoLocked = () => new AppError(403, 'demo_locked', 'This is turned off in the demo');

/** Mounted only when DEMO_MODE=true. */
export const demoGuard: RequestHandler = (req, _res, next) => {
  if (!READS.has(req.method) && LOCKED.some((re) => re.test(req.path))) return next(demoLocked());
  next();
};
