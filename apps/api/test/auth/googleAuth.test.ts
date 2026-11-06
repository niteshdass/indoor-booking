import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { createGoogleVerifier } from '../../src/auth/google';

beforeAll(async () => {
  await startTestDb();
  await User.init();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await User.deleteMany({});
  ctx = buildTestApp();
  ctx.services.google.register('tok-1', {
    sub: 'g1',
    email: 'Ana@Gmail.com',
    emailVerified: true,
    name: 'Ana',
  });
});

const google = (idToken: string) => request(ctx.app).post('/api/v1/auth/google').send({ idToken });

describe('Google sign-in', () => {
  it('first Google login creates the user (201), second logs in (200)', async () => {
    const first = await google('tok-1');
    expect(first.status).toBe(201);
    expect(first.body.user).toMatchObject({
      name: 'Ana',
      email: 'ana@gmail.com',
      emailVerified: true,
      hasGoogle: true,
      hasPassword: false,
    });
    const second = await google('tok-1');
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('an unverified copy of the email on a phone account gives way to Google, which proved it', async () => {
    const squatter = await User.create({ email: 'ana@gmail.com', passwordHash: 'x', phone: '+8801712345678', phoneVerified: true });
    const res = await google('tok-1');
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('ana@gmail.com');
    const left = await User.findById(squatter._id).lean();
    expect(left?.email).toBeUndefined();
    expect(left?.passwordHash).toBeUndefined();
    expect(left?.phone).toBe('+8801712345678');
  });
  it('a verified copy of the email still blocks Google sign-up', async () => {
    await User.create({ email: 'ana@gmail.com', emailVerified: true, passwordHash: 'x', phone: '+8801712345678' });
    const res = await google('tok-1');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('account_exists');
  });
  it('Google email matching an email/password account → 409 account_exists, no link made', async () => {
    await User.create({ email: 'ana@gmail.com', passwordHash: 'x' });
    const res = await google('tok-1');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('account_exists');
    expect(await User.countDocuments({ googleSub: 'g1' })).toBe(0);
  });

  it('unverified Google email is not stored and never blocks or links', async () => {
    await User.create({ email: 'eve@x.com', passwordHash: 'x' });
    ctx.services.google.register('tok-2', { sub: 'g2', email: 'eve@x.com', emailVerified: false });
    const res = await google('tok-2');
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBeNull();
  });

  it('unknown token → 401 invalid_google_token', async () => {
    const res = await google('bad');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_google_token');
  });

  it('disabled Google account → 403 account_disabled', async () => {
    await User.create({ googleSub: 'g1', status: 'disabled' });
    const res = await google('tok-1');
    expect(res.status).toBe(403);
  });

  it('verifier without client id → 503 google_not_configured', async () => {
    await expect(createGoogleVerifier(async () => undefined).verify('x')).rejects.toMatchObject({
      status: 503,
      code: 'google_not_configured',
    });
  });

  it('real verifier rejects a garbage token → 401 invalid_google_token', async () => {
    await expect(createGoogleVerifier(async () => 'client-id').verify('garbage')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_google_token',
    });
  });
});
