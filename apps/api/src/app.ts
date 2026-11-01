import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config';
import type { AppServices } from './services';
import { AppError, errorHandler, notFound } from './errors';
import { healthRouter } from './routes/health';
import { sessionRouter } from './auth/routes/session';
import { emailAuthRouter } from './auth/routes/emailAuth';
import { phoneAuthRouter } from './auth/routes/phoneAuth';
import { authProvidersRouter, googleAuthRouter } from './auth/routes/googleAuth';
import { meRouter } from './auth/routes/me';
import { ownerRouter } from './tenancy/routes/owner';
import { myMembershipsRouter } from './tenancy/routes/myMemberships';
import { applyOwnerRouter } from './tenancy/routes/apply';
import { adminRouter } from './admin/routes';
import { publicVenuesRouter } from './venues/routes/public';
import { publicSlotsRouter } from './schedule/routes/publicSlots';
import { publicAddonsRouter } from './addons/routes/publicAddons';
import { publicBookingsRouter } from './bookings/routes/public';
import { playerSeriesRouter } from './series/routes/player';
import { publicReviewsRouter } from './reviews/routes/public';
import { playerReviewsRouter } from './reviews/routes/player';
import { searchRouter } from './search/routes';
import { webhooksRouter } from './payments/routes/webhooks';
import { publicImagesRouter } from './images/routes';
import { MongoRateLimitStore } from './rateLimitStore';
import { normalizeEmail, normalizePhone } from './auth/normalize';
import { jobsTickRouter } from './jobs/tick';

export type AppDeps = {
  config: Config;
  dbState: () => 'up' | 'down';
  services: AppServices;
  /** Rate-limit /auth; defaults to on outside tests. */
  rateLimit?: boolean;
  /** Keep rate-limit counts in MongoDB, shared by every server; defaults to on outside tests. */
  sharedRateLimits?: boolean;
  extraRoutes?: (router: express.Router) => void;
};

const WINDOW_MS = 15 * 60_000;

/** Routes that send an SMS or email code: each send costs money, so they share one tight per-IP bucket. */
const CODE_SEND_PATHS = [
  '/auth/otp/request',
  '/auth/register/otp/request',
  '/me/link/phone/request',
  '/me/email/verify/request',
  '/venues/:slug/bookings/otp',
  '/bookings/lookup/otp',
];

/** Routes that write a booking, a payment claim or a review: each one lands in front of venue staff. */
const BOOKING_WRITE_PATHS = [
  '/venues/:slug/turfs/:turfId/bookings',
  '/venues/:slug/turfs/:turfId/series',
  '/venues/:slug/turfs/:turfId/series/preview',
  '/bookings/:bookingId/payments/manual',
  '/bookings/:bookingId/payment',
  '/me/bookings/:bookingId/review',
];

/** The guest phone a booking request books for, normalized so spacing tricks share one bucket. */
function guestPhoneOf(req: express.Request): string | undefined {
  const phone = (req.body as { guest?: { phone?: unknown } } | undefined)?.guest?.phone;
  if (typeof phone !== 'string' || !phone.trim()) return undefined;
  try {
    return normalizePhone(phone);
  } catch {
    return phone.trim();
  }
}

/** The email a sign-in names, normalized so case and spacing tricks share one bucket. */
function loginEmailOf(req: express.Request): string | undefined {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string' || !email.trim()) return undefined;
  try {
    return normalizeEmail(email);
  } catch {
    return email.trim().toLowerCase();
  }
}

type LimiterKey = {
  keyGenerator(req: express.Request): string;
  skip(req: express.Request): boolean;
  skipSuccessfulRequests?: boolean;
};

function makeLimiter(shared: boolean) {
  return (name: string, limit: number, windowMs = WINDOW_MS, key?: LimiterKey): express.RequestHandler =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ...key,
      ...(shared ? { store: new MongoRateLimitStore(name) } : {}),
      handler: (_req, _res, next) => {
        next(new AppError(429, 'rate_limited', 'Too many requests; try again later'));
      },
    });
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (deps.config.trustProxy !== undefined) app.set('trust proxy', deps.config.trustProxy);
  // credentials: the web app sends the httpOnly refresh cookie cross-origin.
  app.use(cors({ origin: deps.config.corsOrigin, credentials: true }));
  // Signatures cover the exact bytes, so webhooks take the raw body: before express.json() and every rate limiter.
  app.use('/api/v1/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhooksRouter(deps.config, deps.services));
  app.use(express.json());
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter(deps.dbState));
  const { cronSecret } = deps.config;
  if (cronSecret) api.use(jobsTickRouter({ config: deps.config, services: deps.services, cronSecret }));

  const authDeps = { config: deps.config, services: deps.services };
  const auth = express.Router();
  const limited = deps.rateLimit ?? deps.config.nodeEnv !== 'test';
  const limiter = makeLimiter(deps.sharedRateLimits ?? deps.config.nodeEnv !== 'test');
  // Loose enough for many players behind one carrier NAT address.
  const writeLimit = limiter('booking-write', 60);
  if (limited) {
    api.post(CODE_SEND_PATHS, limiter('code-send', 10, 60 * 60_000));
    // Reference and phone are the only secret here, so guessing them is throttled like a sign-in.
    api.use('/bookings/lookup', limiter('lookup', 30));
    // Quotes follow every slot pick, so they get a looser bucket than the writes they lead to.
    api.post('/venues/:slug/turfs/:turfId/quote', limiter('quote', 300));
    api.use(BOOKING_WRITE_PATHS, (req, res, next) => (req.method === 'GET' ? next() : writeLimit(req, res, next)));
    // A guest booking also counts against its phone, so rotating addresses cannot flood one number's venue.
    api.post(
      '/venues/:slug/turfs/:turfId/bookings',
      limiter('guest-phone', 10, 60 * 60_000, {
        keyGenerator: (req) => `phone:${guestPhoneOf(req)}`,
        skip: (req) => guestPhoneOf(req) === undefined,
      }),
    );
  }
  // Refresh runs on every page load and token expiry, so it gets its own, looser bucket.
  if (limited) auth.use('/refresh', limiter('refresh', 120));
  auth.use(sessionRouter(authDeps));
  auth.use(authProvidersRouter(authDeps));
  if (limited) {
    auth.use(limiter('auth', 20));
    // Failed sign-ins also count against the account, so spreading guesses over many addresses does not help.
    auth.post(
      '/login',
      limiter('login-account', 10, WINDOW_MS, {
        keyGenerator: (req) => `email:${loginEmailOf(req)}`,
        skip: (req) => loginEmailOf(req) === undefined,
        skipSuccessfulRequests: true,
      }),
    );
  }
  auth.use(emailAuthRouter(authDeps));
  auth.use(phoneAuthRouter(authDeps));
  auth.use(googleAuthRouter(authDeps));
  api.use('/auth', auth);
  api.use(meRouter(authDeps));
  api.use(myMembershipsRouter(authDeps));
  api.use(publicVenuesRouter());
  api.use(publicImagesRouter());
  api.use(publicReviewsRouter());
  api.use(publicSlotsRouter(deps.services));
  api.use(publicAddonsRouter());
  api.use(searchRouter(deps.services, limited ? limiter('search', 300) : undefined));
  api.use(publicBookingsRouter(deps.config, deps.services));
  api.use(playerSeriesRouter(deps.config, deps.services));
  api.use(playerReviewsRouter(deps.config, deps.services));
  api.use(applyOwnerRouter(authDeps));
  api.use('/owners/:ownerId', ownerRouter(authDeps));
  api.use('/admin', adminRouter(authDeps));

  deps.extraRoutes?.(api);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
