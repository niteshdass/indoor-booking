import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { issueTokens } from '../../src/auth/tokens';
import { requireAuth } from '../../src/auth/requireAuth';
import { signAccessToken } from '../../src/auth/jwt';
import { refreshCookie } from '../helpers/refreshCookie';

beforeAll(async () => {
  await startTestDb();
  await User.init();
  await RefreshToken.init();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let uid: string;

beforeEach(async () => {
  await User.deleteMany({});
  await RefreshToken.deleteMany({});
  const services = makeTestServices();
  ctx = buildTestApp({
    services,
    extraRoutes: (router) => {
      router.get('/__test/whoami', requireAuth(testConfig, services), (req, res) => {
        res.json(req.auth);
      });
    },
  });
  uid = (await User.create({ name: 'A' })).id;
});

const refresh = (rt?: string) => {
  const req = request(ctx.app).post('/api/v1/auth/refresh');
  return rt === undefined ? req : req.set('Cookie', `rt=${rt}`);
};

describe('refresh tokens', () => {
  it('refresh rotates the token', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await refresh(t.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(uid);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/^rt=.*HttpOnly/);
    expect(refreshCookie(res)).not.toBe(t.refreshToken);
  });

  it('reusing a rotated token → 401 token_reused and kills the family', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const r1 = await refresh(t.refreshToken);
    const r2 = await refresh(t.refreshToken);
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe('token_reused');
    const r3 = await refresh(refreshCookie(r1));
    expect(r3.status).toBe(401);
    expect(r3.body.error.code).toBe('invalid_refresh_token');
  });

  it('refresh accepts the rt cookie', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await request(ctx.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `rt=${t.refreshToken}`);
    expect(res.status).toBe(200);
  });

  it('missing or unknown refresh token → 401 invalid_refresh_token', async () => {
    expect((await refresh()).body.error.code).toBe('invalid_refresh_token');
    expect((await refresh('nope')).body.error.code).toBe('invalid_refresh_token');
  });

  it('a refresh token in the body is ignored', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await request(ctx.app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh_token');
  });

  it('expired refresh token → 401 invalid_refresh_token', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    ctx.services.clock.advance(31 * 24 * 3600_000);
    const res = await refresh(t.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh_token');
  });

  it('refresh for a disabled user → 403 account_disabled', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    await User.updateOne({ _id: uid }, { status: 'disabled' });
    const res = await refresh(t.refreshToken);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_disabled');
  });

  it('logout revokes the family and clears the cookie', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const out = await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `rt=${t.refreshToken}`);
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie']?.[0]).toMatch(/^rt=;/);
    const res = await refresh(t.refreshToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh_token');
  });

  it('stores only a hash of the refresh token', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const doc = await RefreshToken.findOne({ userId: uid }).lean();
    expect(doc?.tokenHash).not.toBe(t.refreshToken);
    expect(JSON.stringify(doc)).not.toContain(t.refreshToken);
  });
});

describe('requireAuth', () => {
  const whoami = () => request(ctx.app).get('/api/v1/__test/whoami');

  it('valid token → req.auth.userId', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await whoami().set('Authorization', `Bearer ${t.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: uid });
  });
  it('missing header → 401 unauthenticated', async () => {
    const res = await whoami();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
  it('bad token → 401 invalid_token', async () => {
    const res = await whoami().set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });
  it('token for a user that no longer exists → 401 invalid_token', async () => {
    const tok = await signAccessToken('000000000000000000000000', ctx.config.jwtSecret, ctx.services.now());
    const res = await whoami().set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_token');
  });
  it('disabled user → 403 account_disabled', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    await User.updateOne({ _id: uid }, { status: 'disabled' });
    const res = await whoami().set('Authorization', `Bearer ${t.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_disabled');
  });
});

describe('user indexes', () => {
  it('allows many users without email/phone/googleSub but rejects duplicate email', async () => {
    await User.create({ name: 'B' });
    await User.create({ email: 'a@x.com' });
    await expect(User.create({ email: 'a@x.com' })).rejects.toMatchObject({ code: 11000 });
  });
});
