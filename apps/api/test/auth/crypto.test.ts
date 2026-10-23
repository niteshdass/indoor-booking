import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../../src/auth/crypto';
import { signAccessToken, verifyAccessToken } from '../../src/auth/jwt';

const SECRET = 'x'.repeat(32);

describe('passwords', () => {
  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct horse');
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
  });
  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('a', 'garbage')).toBe(false);
  });
});

describe('tokens', () => {
  it('access token round-trips and expires after 15 minutes', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const tok = await signAccessToken('u1', SECRET, t0);
    expect(await verifyAccessToken(tok, SECRET, new Date(t0.getTime() + 14 * 60_000))).toEqual({
      userId: 'u1',
    });
    await expect(
      verifyAccessToken(tok, SECRET, new Date(t0.getTime() + 16 * 60_000)),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    await expect(verifyAccessToken(tok, 'y'.repeat(32), t0)).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
  it('garbage access token → invalid_token', async () => {
    await expect(verifyAccessToken('nope', SECRET, new Date())).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
  it('randomToken is url-safe and unique', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it('sha256 is hex', () => {
    expect(sha256('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});
