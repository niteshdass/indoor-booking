import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb } from '../helpers/testDb';
import { buildTestApp } from '../helpers/testApp';
import { seedOwner } from '../helpers/tenancy';
import { seedVenue } from '../helpers/venues';
import { User } from '../../src/auth/user.model';
import { Owner } from '../../src/tenancy/owner.model';
import { Role, ensureSystemRoles } from '../../src/tenancy/role.model';
import { Membership } from '../../src/tenancy/membership.model';
import { Venue } from '../../src/venues/venue.model';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Owner.init(), Role.init(), Membership.init(), Venue.init()]);
  await ensureSystemRoles();
});
afterAll(stopTestDb);

let ctx: ReturnType<typeof buildTestApp>;
let ownerId: string;
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Owner.deleteMany({}),
    Membership.deleteMany({ ownerId: { $exists: true } }),
    Venue.deleteMany({}).setOptions({ crossTenant: true }),
  ]);
  ctx = buildTestApp({ config: { appUrl: 'https://bookaturf.example/' } });
  ownerId = (await seedOwner(ctx.services)).ownerId;
});

describe('robots.txt', () => {
  it('allows player pages, keeps portals out and points at the sitemap', async () => {
    const res = await request(ctx.app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/plain');
    expect(res.text).toContain('User-agent: *\nAllow: /');
    expect(res.text).toContain('Disallow: /owner/');
    expect(res.text).toContain('Disallow: /admin/');
    expect(res.text).toContain('Disallow: /checkout');
    expect(res.text).toContain('Sitemap: https://bookaturf.example/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  it('lists the home page, search and published venues of active owners only', async () => {
    await seedVenue(ownerId, { slug: 'green-turf', published: true });
    await seedVenue(ownerId, { slug: 'hidden-turf', published: false });
    const other = (await seedOwner(ctx.services)).ownerId;
    await seedVenue(other, { slug: 'paused-turf', published: true });
    await Owner.updateOne({ _id: other }, { $set: { status: 'suspended' } });

    const res = await request(ctx.app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/xml');
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://bookaturf.example/',
      'https://bookaturf.example/search',
      'https://bookaturf.example/venues/green-turf',
    ]);
    expect(res.text).toMatch(/<lastmod>\d{4}-\d\d-\d\dT/);
  });
});

describe('venue share preview', () => {
  it('renders Open Graph and Twitter tags for a published venue', async () => {
    const venue = await seedVenue(ownerId, {
      slug: 'green-turf',
      name: 'Green "Turf" & Co',
      published: true,
    });
    await Venue.updateOne(
      { _id: venue._id },
      {
        $set: {
          photos: [
            { url: 'http://plain.example/a.jpg' },
            { url: 'https://cdn.example/b.jpg', alt: 'Pitch' },
          ],
        },
      },
    ).setOptions({ crossTenant: true });

    const res = await request(ctx.app).get('/venues/green-turf');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).toContain(
      '<meta property="og:title" content="Green &quot;Turf&quot; &amp; Co · BookaTurf" />',
    );
    expect(res.text).toContain(
      '<meta property="og:description" content="Road 1, Dhaka. See free times and book online." />',
    );
    expect(res.text).toContain(
      '<meta property="og:url" content="https://bookaturf.example/venues/green-turf" />',
    );
    expect(res.text).toContain('<meta property="og:image" content="https://cdn.example/b.jpg" />');
    expect(res.text).toContain('<meta property="og:image:alt" content="Pitch" />');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(res.text).toContain(
      '<link rel="canonical" href="https://bookaturf.example/venues/green-turf" />',
    );
  });

  it('falls back to a summary card without a usable photo', async () => {
    await seedVenue(ownerId, { slug: 'green-turf', published: true });
    const res = await request(ctx.app).get('/venues/green-turf');
    expect(res.text).toContain('<meta name="twitter:card" content="summary" />');
    expect(res.text).not.toContain('og:image');
  });

  it('unpublished and unknown venues get a generic 404 page that leaks nothing', async () => {
    await seedVenue(ownerId, { slug: 'hidden-turf', name: 'Secret Pitch', published: false });
    for (const slug of ['hidden-turf', 'no-such-turf', 'Bad Slug!']) {
      const res = await request(ctx.app).get(`/venues/${encodeURIComponent(slug)}`);
      expect(res.status, slug).toBe(404);
      expect(res.type).toBe('text/html');
      expect(res.text).not.toContain('Secret Pitch');
      expect(res.text).toContain('<meta property="og:url" content="https://bookaturf.example" />');
    }
  });
});
