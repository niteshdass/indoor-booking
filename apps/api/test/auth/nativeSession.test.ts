import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { User } from '../../src/auth/user.model';
import { RefreshToken } from '../../src/auth/refreshToken.model';
import { issueTokens } from '../../src/auth/tokens';
import { hashPassword } from '../../src/auth/crypto';

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
  ctx = buildTestApp({ services: makeTestServices() });
  uid = (
    await User.create({ name: 'A', email: 'a@x.com', passwordHash: await hashPassword('Passw0rd!long') })
  ).id;
});

const post = (path: string) => request(ctx.app).post(`/api/v1/auth${path}`);
const native = (path: string) => post(path).set('X-Client', 'native');

describe('native client mode', () => {
  it('native login returns refreshToken in body and sets no cookie', async () => {
    const res = await native('/login').send({ email: 'a@x.com', password: 'Passw0rd!long' });
    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe('');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('native refresh rotates the body token', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await native('/refresh').send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(t.refreshToken);
    expect(res.headers['set-cookie']).toBeUndefined();
    const reused = await native('/refresh').send({ refreshToken: t.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('token_reused');
  });

  it('native logout revokes the body token', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const out = await native('/logout').send({ refreshToken: t.refreshToken });
    expect(out.status).toBe(204);
    const res = await native('/refresh').send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(401);
  });

  it('cookie wins over native header', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await native('/refresh').set('Cookie', `rt=${t.refreshToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie']?.[0]).toMatch(/^rt=/);
  });

  it('body token ignored without native header', async () => {
    const t = await issueTokens(uid, ctx.services, ctx.config);
    const res = await post('/refresh').send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_refresh_token');
  });
});
