import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { AppServices } from '../services';
import { verifyAccessToken } from './jwt';
import { User, assertActive } from './user.model';

/** Validates the Bearer token in `header` and returns the signed-in user id. */
async function authenticate(header: string, config: Config, services: AppServices): Promise<string> {
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AppError(401, 'unauthenticated', 'Sign in required');
  const { userId } = await verifyAccessToken(match[1], config.jwtSecret, services.now());
  const user = mongoose.isValidObjectId(userId)
    ? await User.findById(userId, { status: 1 }).lean()
    : null;
  if (!user) throw new AppError(401, 'invalid_token', 'Invalid or expired access token');
  assertActive(user);
  return userId;
}

export function requireAuth(config: Config, services: AppServices): RequestHandler {
  return async (req, _res, next) => {
    req.auth = { userId: await authenticate(req.get('authorization') ?? '', config, services) };
    next();
  };
}

/** No Authorization header: continue as a guest. With one, exactly requireAuth: a bad token is a 401, never a guest. */
export function optionalAuth(config: Config, services: AppServices): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    if (header !== undefined) req.auth = { userId: await authenticate(header, config, services) };
    next();
  };
}
