import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { OtpCode } from '../../src/auth/otp.model';
import { OtpThrottle } from '../../src/auth/otpThrottle.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), OtpCode.init(), OtpThrottle.init(), RefreshToken.init()]);
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), OtpCode.deleteMany({}), OtpThrottle.deleteMany({}), RefreshToken.deleteMany({})]);
  ctx = buildTestApp();
  ctx.services.google.register('tok-1', { sub: 'g1', email: 'ana@gmail.com', emailVerified: true, name: 'Ana' });
});

const PHONE = '+8801712345678';
const api = () => request(ctx.app);

async function emailUser(email = 'ana@x.com') {
  const res = await api().post('/api/v1/auth/register').send({ name: 'Ana', email, password: 'secret123' });
  return { id: res.body.user.id as string, auth: `Bearer ${res.body.accessToken}` };
}
async function phoneUser(phone = PHONE) {
  await api().post('/api/v1/auth/otp/request').send({ phone });
  const res = await api().post('/api/v1/auth/otp/verify').send({ phone, code: '123456' });
  ctx.services.clock.advance(61_000);
  return { id: res.body.user.id as string, auth: `Bearer ${res.body.accessToken}` };
}
async function linkPhone(auth: string, phone = PHONE) {
  const r = await api().post('/api/v1/me/link/phone/request').set('Authorization', auth).send({ phone });
  if (r.status !== 202) return r;
  return api().post('/api/v1/me/link/phone/verify').set('Authorization', auth).send({ phone, code: '123456' });
}

describe('/me', () => {
  it('GET /me returns the public user; without token → 401 unauthenticated', async () => {
    const u = await emailUser();
    const res = await api().get('/api/v1/me').set('Authorization', u.auth);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: u.id, name: 'Ana', email: 'ana@x.com' });
    const anon = await api().get('/api/v1/me');
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe('unauthenticated');
  });

  it('PATCH /me updates name; empty name → 400 validation_error', async () => {
    const u = await emailUser();
    const res = await api().patch('/api/v1/me').set('Authorization', u.auth).send({ name: ' Ivan ' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Ivan');
    const bad = await api().patch('/api/v1/me').set('Authorization', u.auth).send({ name: '  ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });
});

describe('account linking', () => {
  it('email user links a phone, then can sign in with OTP as the same user id', async () => {
    const u = await emailUser();
    const linked = await linkPhone(u.auth, '+880 1712-345678');
    expect(linked.status).toBe(200);
    expect(linked.body.user.phone).toBe(PHONE);
    ctx.services.clock.advance(61_000);
    await api().post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const login = await api().post('/api/v1/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(u.id);
  });

  it('a login-purpose code cannot be used to link', async () => {
    const u = await emailUser();
    await api().post('/api/v1/auth/otp/request').send({ phone: PHONE });
    const res = await api()
      .post('/api/v1/me/link/phone/verify')
      .set('Authorization', u.auth)
      .send({ phone: PHONE, code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('otp_invalid');
  });

  it('phone user links Google, then Google login returns the same user id', async () => {
    const u = await phoneUser();
    const linked = await api().post('/api/v1/me/link/google').set('Authorization', u.auth).send({ idToken: 'tok-1' });
    expect(linked.status).toBe(200);
    expect(linked.body.user.hasGoogle).toBe(true);
    const again = await api().post('/api/v1/me/link/google').set('Authorization', u.auth).send({ idToken: 'tok-1' });
    expect(again.status).toBe(200);
    const login = await api().post('/api/v1/auth/google').send({ idToken: 'tok-1' });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(u.id);
  });

  it('phone user adds email+password, then email login returns the same user id', async () => {
    const u = await phoneUser();
    const linked = await api()
      .post('/api/v1/me/link/email')
      .set('Authorization', u.auth)
      .send({ email: ' Ivan@X.com', password: 'secret123' });
    expect(linked.status).toBe(200);
    expect(linked.body.user).toMatchObject({ email: 'ivan@x.com', hasPassword: true, emailVerified: false });
    const login = await api().post('/api/v1/auth/login').send({ email: 'ivan@x.com', password: 'secret123' });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(u.id);
  });

  it('Google user (email, no password) can add a password for that same email', async () => {
    const g = await api().post('/api/v1/auth/google').send({ idToken: 'tok-1' });
    const res = await api()
      .post('/api/v1/me/link/email')
      .set('Authorization', `Bearer ${g.body.accessToken}`)
      .send({ email: 'ana@gmail.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'ana@gmail.com', hasPassword: true, emailVerified: true });
  });

  it('linking a phone that belongs to another account → 409 identity_in_use', async () => {
    await phoneUser();
    const u = await emailUser();
    const res = await linkPhone(u.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('identity_in_use');
  });

  it('linking Google that belongs to another account → 409 identity_in_use', async () => {
    await api().post('/api/v1/auth/google').send({ idToken: 'tok-1' });
    const u = await phoneUser();
    const res = await api().post('/api/v1/me/link/google').set('Authorization', u.auth).send({ idToken: 'tok-1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('identity_in_use');
  });

  it('linking an email used by another account → 409 identity_in_use', async () => {
    await emailUser('taken@x.com');
    const u = await phoneUser();
    const res = await api()
      .post('/api/v1/me/link/email')
      .set('Authorization', u.auth)
      .send({ email: 'TAKEN@x.com', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('identity_in_use');
  });

  it('linking email when one is already set → 409 email_already_set', async () => {
    const u = await emailUser();
    const res = await api()
      .post('/api/v1/me/link/email')
      .set('Authorization', u.auth)
      .send({ email: 'other@x.com', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_already_set');
  });
});
