import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import type { Config } from './config';
import type { AppServices } from './services';
import { errorHandler, notFound } from './errors';
import { healthRouter } from './routes/health';
import { sessionRouter } from './auth/routes/session';

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
  auth.use(sessionRouter(authDeps));
  api.use('/auth', auth);

  deps.extraRoutes?.(api);
  app.use('/api/v1', api);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
