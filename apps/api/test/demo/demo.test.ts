import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { DEMO_ACCOUNTS } from '../../src/demo/accounts';
import { loadConfig } from '../../src/config';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), RefreshToken.init()]);
});
afterAll(stopTestDb);

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
});

const demo = () => buildTestApp({ config: { demoMode: true } }).app;
const plain = () => buildTestApp().app;

describe('demo mode', () => {
  it('reports itself on /auth/providers', async () => {
    expect((await request(demo()).get('/api/v1/auth/providers')).body).toEqual({ googleClientId: null, demo: true });
    expect((await request(plain()).get('/api/v1/auth/providers')).body.demo).toBe(false);
  });

  it('signs in as the seeded account for a role, without a password', async () => {
    await User.create({ name: 'Venue Owner', email: DEMO_ACCOUNTS.owner });
    const res = await request(demo()).post('/api/v1/auth/demo/owner');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(DEMO_ACCOUNTS.owner);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('refuses an unknown role, an unseeded database and a disabled account', async () => {
    const app = demo();
    expect((await request(app).post('/api/v1/auth/demo/root')).status).toBe(404);
    const missing = await request(app).post('/api/v1/auth/demo/player');
    expect([missing.status, missing.body.error.code]).toEqual([503, 'demo_not_seeded']);
    await User.create({ name: 'P', email: DEMO_ACCOUNTS.player, status: 'disabled' });
    expect((await request(app).post('/api/v1/auth/demo/player')).body.error.code).toBe('account_disabled');
  });

  it('has no demo sign-in outside demo mode', async () => {
    await User.create({ name: 'Admin', email: DEMO_ACCOUNTS.admin });
    expect((await request(plain()).post('/api/v1/auth/demo/admin')).status).toBe(404);
  });

  it.each([
    ['put', '/admin/settings/email'],
    ['put', '/admin/settings/payout-stripe'],
    ['delete', '/admin/settings/sms'],
    ['post', '/admin/settings/email/test'],
    ['put', '/owners/abc/payment-gateways/stripe'],
    ['patch', '/owners/abc/payment-gateways/bkash'],
    ['post', '/admin/users/abc/disable'],
    ['post', '/admin/owners/abc/suspend'],
    ['delete', '/owners/abc/members/m1'],
    ['patch', '/me'],
    ['post', '/me/link/email'],
    ['post', '/me/email/verify/request'],
    ['post', '/auth/password/forgot'],
  ] as const)('locks %s %s before auth runs', async (method, path) => {
    const res = await request(demo())[method](`/api/v1${path}`).send({});
    expect([res.status, res.body.error.code]).toEqual([403, 'demo_locked']);
  });

  it('leaves reads and everyday writes open', async () => {
    const app = demo();
    // Reaches the real route, which wants a session.
    expect((await request(app).get('/api/v1/admin/settings')).status).toBe(401);
    expect((await request(app).post('/api/v1/me/bookings/b1/cancel')).status).toBe(401);
    expect((await request(app).post('/api/v1/owners/abc/members')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'x@y.z', password: 'nope1234' })).status).toBe(401);
  });

  it('locks nothing outside demo mode', async () => {
    expect((await request(plain()).put('/api/v1/admin/settings/email').send({})).status).toBe(401);
  });
});

describe('demo hosts', () => {
  const prod = {
    MONGODB_URI: 'mongodb://x',
    JWT_SECRET: 's'.repeat(32),
    NODE_ENV: 'production',
    PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    APP_URL: 'https://demo.example.com',
    DEMO_MODE: 'true',
    TRUST_PROXY: '1',
  };

  it('refuses to boot a production demo without DEMO_HOSTS', () => {
    expect(() => loadConfig(prod)).toThrow(/DEMO_HOSTS: is required with DEMO_MODE=true in production/);
    expect(loadConfig({ ...prod, DEMO_MODE: 'false' }).demoMode).toBeUndefined();
    expect(loadConfig({ ...prod, NODE_ENV: 'development' }).demoMode).toBe(true);
  });

  it('refuses to boot when the app or API host is not on the list', () => {
    expect(() => loadConfig({ ...prod, DEMO_HOSTS: 'other.example.com' })).toThrow(/APP_URL: host is not in DEMO_HOSTS/);
    expect(() => loadConfig({ ...prod, DEMO_HOSTS: 'demo.example.com', API_URL: 'https://api.example.com' })).toThrow(
      /API_URL: host is not in DEMO_HOSTS/,
    );
    const c = loadConfig({ ...prod, DEMO_HOSTS: ' Demo.Example.com , api.example.com', API_URL: 'https://api.example.com' });
    expect(c.demoHosts).toEqual(['demo.example.com', 'api.example.com']);
  });

  it('a production demo signs in only on a listed host', async () => {
    await User.create({ name: 'Venue Owner', email: DEMO_ACCOUNTS.owner });
    const app = buildTestApp({ config: { demoMode: true, nodeEnv: 'production', demoHosts: ['demo.example.com'] } }).app;
    const stray = await request(app).post('/api/v1/auth/demo/owner').set('Host', 'prod.example.com');
    expect(stray.status).toBe(404);
    const listed = await request(app).post('/api/v1/auth/demo/owner').set('Host', 'demo.example.com');
    expect(listed.status).toBe(200);
  });
});
