import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { requirePermission } from '../../tenancy/context';

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
/** google.com, maps.google.com, www.google.com.bd and the like: where a share link may lead. */
const GOOGLE_HOST_RE = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|com?\.[a-z]{2})$/;
const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;

const unresolved = () => new AppError(422, 'map_link_unresolved', 'Could not open this map link');

const allowed = (u: URL) => u.protocol === 'https:' && (SHORT_HOSTS.has(u.hostname) || GOOGLE_HOST_RE.test(u.hostname));

/**
 * Follows a Google Maps share link (maps.app.goo.gl/…) to the full link, which carries the coordinates; the
 * browser cannot, as Google sends no CORS headers. Only Google hosts are fetched, and only their redirects read.
 */
export async function expandMapLink(link: string, fetchFn: typeof fetch): Promise<string> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw unresolved();
  }
  if (!allowed(url) || !SHORT_HOSTS.has(url.hostname)) throw unresolved();
  for (let hop = 0; hop < MAX_HOPS && SHORT_HOSTS.has(url.hostname); hop++) {
    let res: Response;
    try {
      res = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw unresolved();
    }
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) throw unresolved();
    url = new URL(next, url);
    if (!allowed(url)) throw unresolved();
  }
  if (SHORT_HOSTS.has(url.hostname)) throw unresolved();
  return url.toString();
}

/** Mounted on ownerRouter. */
export function mapLinkRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  const body = z.object({ url: z.string().trim().max(2000) }).strict();

  router.post('/map-link', requirePermission('venue.manage'), async (req, res) => {
    const { url } = body.parse(req.body);
    res.json({ url: await expandMapLink(url, services.fetch ?? fetch) });
  });

  return router;
}
