import { Router, type RequestHandler } from 'express';
import { SPORTS, localParts, type SearchResponse, type SearchResult } from '@booking/shared';
import type { AppServices } from '../services';
import { dayBatch, inWindow, loadDay, type DaySources } from '../schedule/load';
import { ratingJson } from '../reviews/rating';
import { findCandidates, type Candidate } from './candidates';
import { parseSearchQuery, type SearchQuery } from './query';
import { summarizeDay, type DaySummary } from './summarize';

/** How many candidate venues one request reads; tests lower it to exercise paging. */
export const searchConfig = { scanBatch: 100 };

/** Venues whose days are loaded at once, with one batch of reads (dayBatch) per wave. */
const CONCURRENCY = 8;

/** Unauthenticated venue search across every owner. */
export function searchRouter(services: AppServices, limiter?: RequestHandler): Router {
  const router = Router();

  router.get('/search', ...(limiter ? [limiter] : []), async (req, res) => {
    const q = parseSearchQuery(req.query);
    const now = services.now();
    const { scanBatch } = searchConfig;
    const candidates = await findCandidates(q, q.cursor, scanBatch);

    // Venues load in waves of CONCURRENCY but are taken in order; ones after a full page are not walked.
    const out: SearchResult[] = [];
    let walked = 0;
    while (walked < candidates.length && out.length < q.limit) {
      const batch = candidates.slice(walked, walked + CONCURRENCY).map((c) => ({
        c,
        date: q.date ?? localParts(now, c.venue.timezone).date,
      }));
      const sources = await dayBatch(
        batch.map(({ c, date }) => ({ ownerId: String(c.venue.ownerId), venue: c.venue, turfs: c.turfs, date })),
        now,
      );
      const wave = await Promise.all(
        batch.map(async ({ c, date }) => ({ c, date, summary: await summarize(c, date, q, now, sources) })),
      );
      for (const { c, date, summary } of wave) {
        if (out.length >= q.limit) break;
        walked++;
        if (keep(summary, q)) out.push(resultJson(c, date, summary));
      }
    }

    // A full batch may have more behind it; a short one that was walked to the end has not.
    const more = walked < candidates.length || candidates.length === scanBatch;
    const body: SearchResponse = { results: out, nextCursor: more ? q.cursor + walked : null };
    res.json(body);
  });

  return router;
}

async function summarize(c: Candidate, date: string, q: SearchQuery, now: Date, sources: DaySources): Promise<DaySummary> {
  const ownerId = String(c.venue.ownerId);
  const days = await Promise.all(
    c.turfs.map(async (turf) => {
      const { day, settings } = await loadDay(ownerId, c.venue, turf, date, now, sources);
      return {
        turfId: turf.id as string,
        turfName: turf.name,
        open: !day.closed && inWindow(date, now, c.venue.timezone, settings.bookingWindowDays),
        slots: day.slots,
      };
    }),
  );
  return summarizeDay(days, { range: q.range, minPrice: q.minPrice, maxPrice: q.maxPrice });
}

/** Plain listing keeps every candidate; a time or price range needs a match; available=true needs a free slot. */
function keep(s: DaySummary, q: SearchQuery): boolean {
  if (q.available) return s.nextFreeSlot !== null;
  if (q.range || q.minPrice !== null || q.maxPrice !== null) return s.matched > 0;
  return true;
}

function resultJson(c: Candidate, date: string, s: DaySummary): SearchResult {
  const { venue } = c;
  const [lng, lat] = venue.location!.coordinates as [number, number];
  const photo = venue.photos[0];
  const sports = new Set(c.turfs.flatMap((t) => t.sports));
  return {
    slug: venue.slug,
    name: venue.name,
    address: venue.address,
    city: venue.city,
    country: venue.country,
    currency: venue.currency,
    timezone: venue.timezone,
    location: { lat, lng },
    photo: photo ? { url: photo.url, ...(photo.alt ? { alt: photo.alt } : {}) } : null,
    sports: SPORTS.filter((sport) => sports.has(sport)),
    distanceMeters: c.distanceMeters,
    date,
    fromPrice: s.fromPrice,
    nextFreeSlot: s.nextFreeSlot,
    rating: ratingJson(venue.rating),
  };
}
