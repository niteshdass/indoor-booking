import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthDeps } from '../deps';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  revokeFamilyByToken,
  rotateRefreshToken,
  sendAuthResponse,
} from '../tokens';
import { AppError } from '../../errors';

const bodySchema = z.object({ refreshToken: z.string().min(1).optional() }).default({});

function presentedToken(req: Request): string | undefined {
  const fromBody = bodySchema.parse(req.body ?? {}).refreshToken;
  const fromCookie = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return fromBody ?? (typeof fromCookie === 'string' && fromCookie ? fromCookie : undefined);
}

export function sessionRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  router.post('/refresh', async (req, res) => {
    const raw = presentedToken(req);
    if (!raw) throw new AppError(401, 'invalid_refresh_token', 'Invalid or expired refresh token');
    const { user, accessToken, refreshToken } = await rotateRefreshToken(raw, services, config);
    sendAuthResponse(res, 200, user, { accessToken, refreshToken }, config);
  });

  router.post('/logout', async (req, res) => {
    const raw = presentedToken(req);
    if (raw) await revokeFamilyByToken(raw, services.now());
    clearRefreshCookie(res, config);
    res.status(204).end();
  });

  return router;
}
