import { Router, type RequestHandler } from 'express';
import type { Config } from '../config';
import { AppError } from '../errors';
import { Owner } from '../tenancy/owner.model';
import { Venue } from '../venues/venue.model';
import { publicVenueBySlug } from '../venues/routes/public';

const BRAND = 'BookaTurf';
const DEFAULT_DESCRIPTION = 'Find a turf near you, see the free times and book online in a minute.';
/** Player pages crawlers may index; portals, checkout and personal pages stay out. */
const PRIVATE_PATHS = [
  '/owner/',
  '/admin/',
  '/checkout',
  '/pay/',
  '/bookings',
  '/me',
  '/login',
  '/register',
  '/apply',
  '/lookup',
];
/** Sitemap entries are cached by crawlers for hours anyway; this keeps a burst of them off the database. */
const CACHE = 'public, max-age=600';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

type Preview = {
  title: string;
  description: string;
  url: string;
  image?: string;
  imageAlt?: string;
};

/** The tags a link-preview bot reads; humans are sent to the real page by the link. */
function previewHtml(p: Preview): string {
  const tags: [attr: 'property' | 'name', key: string, value: string][] = [
    ['property', 'og:site_name', BRAND],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', p.title],
    ['property', 'og:description', p.description],
    ['property', 'og:url', p.url],
    ['name', 'twitter:card', p.image ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', p.title],
    ['name', 'twitter:description', p.description],
  ];
  if (p.image) {
    tags.push(['property', 'og:image', p.image], ['name', 'twitter:image', p.image]);
    if (p.imageAlt) tags.push(['property', 'og:image:alt', p.imageAlt]);
  }
  const meta = tags
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(p.title)}</title>
    <meta name="description" content="${escapeHtml(p.description)}" />
    <link rel="canonical" href="${escapeHtml(p.url)}" />
    ${meta}
  </head>
  <body>
    <a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a>
  </body>
</html>
`;
}

/**
 * Crawler-facing files served from the site root, so the host only has to route these paths to the API:
 * `/robots.txt`, `/sitemap.xml`, and `/venues/:slug` for link-preview bots (see docs/seo.md).
 */
export function seoRouter(config: Config, limiter?: RequestHandler): Router {
  const router = Router();
  const site = config.appUrl.replace(/\/+$/, '');
  if (limiter) router.use(['/sitemap.xml', '/venues/:slug'], limiter);

  router.get('/robots.txt', (_req, res) => {
    const lines = [
      'User-agent: *',
      'Allow: /',
      ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${site}/sitemap.xml`,
      '',
    ];
    res.set('Cache-Control', CACHE).type('text/plain').send(lines.join('\n'));
  });

  router.get('/sitemap.xml', async (_req, res) => {
    const owners = await Owner.find({ status: 'active' }, { _id: 1 }).lean();
    // The public venue list across tenants, same rule as the venue page: published and owner active.
    const venues = await Venue.find(
      { published: true, ownerId: { $in: owners.map((o) => o._id) } },
      { slug: 1, updatedAt: 1 },
    )
      .setOptions({ crossTenant: true })
      .sort({ slug: 1 })
      .lean();
    const urls = [
      `<url><loc>${site}/</loc></url>`,
      `<url><loc>${site}/search</loc></url>`,
      ...venues.map(
        (v) =>
          `<url><loc>${escapeHtml(`${site}/venues/${v.slug}`)}</loc>${v.updatedAt ? `<lastmod>${v.updatedAt.toISOString()}</lastmod>` : ''}</url>`,
      ),
    ];
    res
      .set('Cache-Control', CACHE)
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
      );
  });

  router.get('/venues/:slug', async (req, res) => {
    const url = `${site}/venues/${encodeURIComponent(req.params.slug)}`;
    try {
      const venue = await publicVenueBySlug(req.params.slug);
      const rating = venue.rating?.count
        ? ` Rated ${venue.rating.average?.toFixed(1)} by ${venue.rating.count} players.`
        : '';
      // Only absolute https photos: a preview bot cannot load a relative or plain-http image.
      const photo = venue.photos.find((p) => p.url.startsWith('https://'));
      res
        .set('Cache-Control', CACHE)
        .type('html')
        .send(
          previewHtml({
            title: `${venue.name} · ${BRAND}`,
            description: `${venue.address}, ${venue.city}. See free times and book online.${rating}`,
            url,
            ...(photo ? { image: photo.url, imageAlt: photo.alt ?? venue.name } : {}),
          }),
        );
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 404) throw err;
      res
        .status(404)
        .type('html')
        .send(previewHtml({ title: BRAND, description: DEFAULT_DESCRIPTION, url: site }));
    }
  });

  return router;
}
