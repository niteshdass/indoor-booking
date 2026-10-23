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

export type AppDeps = {
  config: Config;
  dbState: () => 'up' | 'down';
  services: AppServices;
  /** Rate-limit /auth; defaults to on outside tests. */
  rateLimit?: boolean;
  extraRoutes?: (router: express.Router) => void;
};

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: deps.config.corsOrigin }));
  app.use(express.json());
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter(deps.dbState));

  const authDeps = { config: deps.config, services: deps.services };
  const auth = express.Router();
  if (deps.rateLimit ?? deps.config.nodeEnv !== 'test') {
    auth.use(
      rateLimit({
        windowMs: 15 * 60_000,
        limit: 20,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, _res, next) => {
          next(new AppError(429, 'rate_limited', 'Too many requests; try again later'));
        },
      }),
    );
  }
  auth.use(sessionRouter(authDeps));
  auth.use(emailAuthRouter(authDeps));
  auth.use(phoneAuthRouter(authDeps));
  auth.use(googleAuthRouter(authDeps));
  api.use('/auth', auth);

  deps.extraRoutes?.(api);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
