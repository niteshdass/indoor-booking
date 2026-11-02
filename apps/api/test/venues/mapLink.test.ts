import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { makeTestServices } from '../helpers/testServices';
import { addMember, bearer, seedOwner } from '../helpers/tenancy';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';

const FULL = 'https://www.google.com/maps/place/Arena/@23.79,90.41,17z/data=!3d23.7937!4d90.4066';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let a: Awaited<ReturnType<typeof seedOwner>>;
let fetched: string[];
let redirects: Record<string, string>;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Role.deleteMany({ ownerId: { $ne: null } }),
  ]);
  fetched = [];
  redirects = { 'https://maps.app.goo.gl/abc': FULL };
  const services = makeTestServices();
  services.fetch = (async (input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    const to = redirects[url];
    return to ? new Response(null, { status: 302, headers: { location: to } }) : new Response('nope', { status: 404 });
  }) as typeof fetch;
  ctx = buildTestApp({ services });
  a = await seedOwner(ctx.services);
});

const post = (url: string, token = a.token) =>
  request(ctx.app).post(`/api/v1/owners/${a.ownerId}/map-link`).set(...bearer(token)).send({ url });

describe('map link', () => {
  it('follows a Google Maps share link to the full link', async () => {
    const res = await post('https://maps.app.goo.gl/abc');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(FULL);
  });

  it('refuses links that are not Google share links, without fetching them', async () => {
    for (const url of ['http://maps.app.goo.gl/abc', 'https://evil.example/x', 'https://www.google.com/maps/@1,2,3z', 'not a url']) {
      const res = await post(url);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('map_link_unresolved');
    }
    expect(fetched).toEqual([]);
  });

  it('stops when a redirect leaves Google', async () => {
    redirects['https://maps.app.goo.gl/abc'] = 'http://169.254.169.254/latest';
    expect((await post('https://maps.app.goo.gl/abc')).status).toBe(422);
    redirects['https://maps.app.goo.gl/abc'] = 'https://evil.example/maps';
    expect((await post('https://maps.app.goo.gl/abc')).status).toBe(422);
    expect(fetched).toEqual(['https://maps.app.goo.gl/abc', 'https://maps.app.goo.gl/abc']);
  });

  it('needs venue.manage', async () => {
    const staff = await addMember(ctx.services, a.ownerId, {});
    expect((await post('https://maps.app.goo.gl/abc', staff.token)).status).toBe(403);
  });
});
