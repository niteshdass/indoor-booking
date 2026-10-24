import { Router } from 'express';
import { SPORTS, localParts, type SearchResponse, type SearchResult } from '@booking/shared';
import type { AppServices } from '../services';
import { inWindow, loadDay } from '../schedule/load';
import { findCandidates, type Candidate } from './candidates';
import { parseSearchQuery, type SearchQuery } from './query';
import { summarizeDay, type DaySummary } from './summarize';

/** How many candidate venues one request reads; tests lower it to exercise paging. */
export const searchConfig = { scanBatch: 100 };

/** Unauthenticated venue search across every owner. */
export function searchRouter(services: AppServices): Router {
  const router = Router();

  router.get('/search', async (req, res) => {
    const q = parseSearchQuery(req.query);
    const now = services.now();
    const { scanBatch } = searchConfig;
    const candidates = await findCandidates(q, q.cursor, scanBatch);

    const out: SearchResult[] = [];
    let walked = 0;
    for (const c of candidates) {
      if (out.length >= q.limit) break;
      walked++;
      const date = q.date ?? localParts(now, c.venue.timezone).date;
      const summary = await summarize(c, date, q, now);
      if (keep(summary, q)) out.push(resultJson(c, date, summary));
    }

    // A full batch may have more behind it; a short one that was walked to the end has not.
    const more = walked < candidates.length || candidates.length === scanBatch;
    const body: SearchResponse = { results: out, nextCursor: more ? q.cursor + walked : null };
    res.json(body);
  });

  return router;
}

async function summarize(c: Candidate, date: string, q: SearchQuery, now: Date): Promise<DaySummary> {
  const ownerId = String(c.venue.ownerId);
  const days = await Promise.all(
    c.turfs.map(async (turf) => {
      const { day, settings } = await loadDay(ownerId, c.venue, turf, date, now);
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
  };
}
