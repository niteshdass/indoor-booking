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
import { googleAuthRouter } from './auth/routes/googleAuth';
import { meRouter } from './auth/routes/me';
import { ownerRouter } from './tenancy/routes/owner';
import { myMembershipsRouter } from './tenancy/routes/myMemberships';
import { publicVenuesRouter } from './venues/routes/public';
import { publicSlotsRouter } from './schedule/routes/publicSlots';
import { publicAddonsRouter } from './addons/routes/publicAddons';
import { publicBookingsRouter } from './bookings/routes/public';

export type AppDeps = {
  config: Config;
  dbState: () => 'up' | 'down';
  services: AppServices;
  /** Rate-limit /auth; defaults to on outside tests. */
  rateLimit?: boolean;
  extraRoutes?: (router: express.Router) => void;
};

function authLimiter(limit: number): express.RequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
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
  app.use(express.json());
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter(deps.dbState));

  const authDeps = { config: deps.config, services: deps.services };
  const auth = express.Router();
  const limited = deps.rateLimit ?? deps.config.nodeEnv !== 'test';
  // Refresh runs on every page load and token expiry, so it gets its own, looser bucket.
  if (limited) auth.use('/refresh', authLimiter(120));
  auth.use(sessionRouter(authDeps));
  if (limited) auth.use(authLimiter(20));
  auth.use(emailAuthRouter(authDeps));
  auth.use(phoneAuthRouter(authDeps));
  auth.use(googleAuthRouter(authDeps));
  api.use('/auth', auth);
  api.use(meRouter(authDeps));
  api.use(myMembershipsRouter(authDeps));
  api.use(publicVenuesRouter());
  api.use(publicSlotsRouter(deps.services));
  api.use(publicAddonsRouter());
  api.use(publicBookingsRouter(deps.config, deps.services, limited ? authLimiter(20) : undefined));
  api.use('/owners/:ownerId', ownerRouter(authDeps));

  deps.extraRoutes?.(api);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
