import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '../errors';

const ACCESS_TTL_SEC = 15 * 60;

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId: string, secret: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SEC)
    .sign(key(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
  now: Date,
): Promise<{ userId: string }> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      currentDate: now,
    });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string') throw new Error('bad claims');
    return { userId: payload.sub };
  } catch {
    throw new AppError(401, 'invalid_token', 'Invalid or expired access token');
  }
}
