import type { Response } from 'express';
import type { Config } from '../config';
import { AppError } from '../errors';
import type { AppServices } from '../services';
import { randomToken, sha256 } from './crypto';
import { signAccessToken } from './jwt';
import { RefreshToken } from './refreshToken.model';
import { User, assertActive, toPublicUser, type UserDoc } from './user.model';

const REFRESH_TTL_MS = 30 * 24 * 3600_000;
export const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/v1/auth';

export type Tokens = { accessToken: string; refreshToken: string };

const invalidRefresh = () =>
  new AppError(401, 'invalid_refresh_token', 'Invalid or expired refresh token');

export async function issueTokens(
  userId: string,
  services: AppServices,
  config: Config,
  familyId: string = randomToken(16),
): Promise<Tokens> {
  const now = services.now();
  const refreshToken = randomToken();
  await RefreshToken.create({
    userId,
    familyId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
  });
  const accessToken = await signAccessToken(userId, config.jwtSecret, now);
  return { accessToken, refreshToken };
}

/**
 * Marks the presented token used (atomically, so two concurrent refreshes cannot both win)
 * and issues a successor in the same family. Presenting an already-used token revokes the
 * whole family: someone else holds a copy.
 */
export async function rotateRefreshToken(
  raw: string,
  services: AppServices,
  config: Config,
): Promise<{ user: UserDoc } & Tokens> {
  const now = services.now();
  const tokenHash = sha256(raw);
  const current = await RefreshToken.findOneAndUpdate(
    {
      tokenHash,
      usedAt: { $exists: false },
      revokedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
  );
  if (!current) {
    const known = await RefreshToken.findOne({ tokenHash });
    if (known?.usedAt && !known.revokedAt) {
      await revokeFamily(known.familyId, now);
      throw new AppError(401, 'token_reused', 'Refresh token already used; please sign in again');
    }
    throw invalidRefresh();
  }
  const user = await User.findById(current.userId);
  if (!user) throw invalidRefresh();
  assertActive(user);
  const tokens = await issueTokens(user.id as string, services, config, current.familyId);
  return { user, ...tokens };
}

async function revokeFamily(familyId: string, now: Date): Promise<void> {
  await RefreshToken.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } },
  );
}

export async function revokeFamilyByToken(raw: string, now: Date = new Date()): Promise<void> {
  const token = await RefreshToken.findOne({ tokenHash: sha256(raw) });
  if (token) await revokeFamily(token.familyId, now);
}

export async function revokeAllForUser(userId: string, now: Date = new Date()): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now } },
  );
}

export function setRefreshCookie(res: Response, refreshToken: string, config: Config): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: COOKIE_PATH,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearRefreshCookie(res: Response, config: Config): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: COOKIE_PATH,
  });
}

export function sendAuthResponse(
  res: Response,
  status: number,
  user: UserDoc,
  tokens: Tokens,
  config: Config,
): void {
  setRefreshCookie(res, tokens.refreshToken, config);
  res.status(status).json({ user: toPublicUser(user), ...tokens });
}
