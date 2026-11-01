import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp, testConfig } from '../helpers/testApp';
import { createApp } from '../../src/app';
import { dbState } from '../../src/db';
import { makeTestServices } from '../helpers/testServices';
import { loadConfig } from '../../src/config';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { refreshCookie } from '../helpers/refreshCookie';
import { OtpCode } from '../../src/auth/otp.model';
import { OtpThrottle } from '../../src/auth/otpThrottle.model';
import { issueTokens, rotateRefreshToken } from '../../src/auth/tokens';
import { registerAccount } from '../helpers/register';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), RefreshToken.init(), OtpCode.init(), OtpThrottle.init()]);
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), OtpCode.deleteMany({}), OtpThrottle.deleteMany({})]);
  ctx = buildTestApp();
});

const PHONE = '+8801712345678';

describe('C-1 refresh race', () => {
  it('concurrent double refresh → every token in the family is dead afterwards', async () => {
    const uid = (await User.create({ name: 'A' })).id as string;
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const send = (rt: string) =>
      request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rt=${rt}`);
    const results = await Promise.all([send(t.refreshToken), send(t.refreshToken)]);
    for (const r of results.filter((r) => r.status === 200)) {
      expect((await send(refreshCookie(r)!)).status).toBe(401);
    }
    expect(await RefreshToken.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
  });

  it('a reuse revocation landing mid-rotation kills the successor too', async () => {
    const uid = (await User.create({ name: 'A' })).id as string;
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const realCreate = RefreshToken.create.bind(RefreshToken);
    // Simulate the concurrent loser revoking the family just before the winner's successor is saved.
    const spy = vi.spyOn(RefreshToken, 'create').mockImplementationOnce((async (doc: never) => {
      await RefreshToken.updateMany({}, { $set: { revokedAt: new Date() } });
      return realCreate(doc);
    }) as never);
    await expect(rotateRefreshToken(t.refreshToken, ctx.services, ctx.config)).rejects.toMatchObject({
      code: 'token_reused',
    });
    spy.mockRestore();
    expect(await RefreshToken.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
  });

  it('re-presenting a used token after the family was revoked still reports token_reused', async () => {
    const uid = (await User.create({ name: 'A' })).id as string;
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const send = () =>
      request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rt=${t.refreshToken}`);
    await send();
    await send();
    const third = await send();
    expect(third.body.error.code).toBe('token_reused');
  });
});

describe('I-1 OTP throttle under concurrency', () => {
  it('10 parallel requests for one phone send exactly one SMS', async () => {
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(ctx.app).post('/api/v1/auth/otp/request').send({ phone: PHONE }),
      ),
    );
    expect(res.filter((r) => r.status === 202)).toHaveLength(1);
    expect(ctx.services.sms.sent).toHaveLength(1);
  });
});

describe('I-2 phone link does not replace', () => {
  it('linking a different phone when one is set → 409 phone_already_set', async () => {
    const api = () => request(ctx.app);
    await api().post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const u = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    const res = await api()
      .post('/api/v1/me/link/phone/request')
      .set('Authorization', `Bearer ${u.body.accessToken}`)
      .send({ phone: '+79123456789' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('phone_already_set');
    expect(ctx.services.sms.sent).toHaveLength(1);
  });
});

describe('I-3 password reset proves email ownership', () => {
  it('reset marks the email verified', async () => {
    const api = () => request(ctx.app);
    await registerAccount(ctx.app, { name: 'A', email: 'a@x.com', password: 'secret123' });
    await api().post('/api/v1/auth/password/forgot').send({ email: 'a@x.com' });
    const token = /token=([A-Za-z0-9_-]+)/.exec(ctx.services.email.sent.at(-1)?.text ?? '')?.[1];
    expect((await api().post('/api/v1/auth/password/reset').send({ token, password: 'newsecret1' })).status).toBe(204);
    const login = await api().post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'newsecret1' });
    expect(login.body.user.emailVerified).toBe(true);
  });
});

describe('I-4 rate limiter behind proxies', () => {
  it('reads TRUST_PROXY', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 's'.repeat(32) };
    expect(loadConfig(base).trustProxy).toBeUndefined();
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
  });

  it('with trust proxy, clients behind the proxy get separate buckets', async () => {
    const app = createApp({
      config: { ...testConfig, trustProxy: true },
      dbState,
      services: makeTestServices(),
      rateLimit: true,
    });
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `10.0.0.${i}`)
        .send({});
      expect(res.status).toBe(400);
    }
  });

  it('/auth/refresh is not counted by the sign-in limiter', async () => {
    const limited = buildTestApp({ rateLimit: true });
    for (let i = 0; i < 25; i++) {
      const res = await request(limited.app).post('/api/v1/auth/refresh').send({});
      expect(res.status).toBe(401);
    }
  });
});

describe('I-5 CORS credentials', () => {
  it('allows credentials for the configured origin', async () => {
    const res = await request(ctx.app)
      .options('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
