import type { RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { AppServices } from '../services';
import { verifyAccessToken } from './jwt';
import { User } from './user.model';

export function requireAuth(config: Config, services: AppServices): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw new AppError(401, 'unauthenticated', 'Sign in required');
    const { userId } = await verifyAccessToken(match[1], config.jwtSecret, services.now());
    const user = mongoose.isValidObjectId(userId)
      ? await User.findById(userId, { status: 1 }).lean()
      : null;
    if (!user) throw new AppError(401, 'invalid_token', 'Invalid or expired access token');
    if (user.status === 'disabled') {
      throw new AppError(403, 'account_disabled', 'Account is disabled');
    }
    req.auth = { userId };
    next();
  };
}
