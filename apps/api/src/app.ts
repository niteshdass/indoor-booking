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

function makeLimiter(shared: boolean) {
  return (name: string, limit: number, windowMs = WINDOW_MS): express.RequestHandler =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
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

  const authDeps = { config: deps.config, services: deps.services };
  const auth = express.Router();
  const limited = deps.rateLimit ?? deps.config.nodeEnv !== 'test';
  const limiter = makeLimiter(deps.sharedRateLimits ?? deps.config.nodeEnv !== 'test');
  if (limited) {
    api.post(CODE_SEND_PATHS, limiter('code-send', 10, 60 * 60_000));
    // Reference and phone are the only secret here, so guessing them is throttled like a sign-in.
    api.use('/bookings/lookup', limiter('lookup', 30));
  }
  // Refresh runs on every page load and token expiry, so it gets its own, looser bucket.
  if (limited) auth.use('/refresh', limiter('refresh', 120));
  auth.use(sessionRouter(authDeps));
  auth.use(authProvidersRouter(authDeps));
  if (limited) auth.use(limiter('auth', 20));
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
