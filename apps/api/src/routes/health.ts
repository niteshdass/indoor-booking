import { Router } from 'express';

/** 503 while Mongo is unreachable, so load balancers and uptime monitors take this instance out. */
export function healthRouter(dbState: () => 'up' | 'down'): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    const db = dbState();
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db });
  });
  return router;
}
