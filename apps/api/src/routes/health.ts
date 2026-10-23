import { Router } from 'express';

export function healthRouter(dbState: () => 'up' | 'down'): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', db: dbState() });
  });
  return router;
}
