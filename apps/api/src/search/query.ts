import { z } from 'zod';
import { MAX_SEARCH_RADIUS_KM, SPORTS, currencyExponent, type Sport, type TimeRange } from '@booking/shared';
import { AppError } from '../errors';
import { isoDateSchema, timeSchema } from '../schedule/schemas';

export type SearchQuery = {
  near: { lat: number; lng: number } | null;
  radiusKm: number | null;
  sport: Sport | null;
  indoor: boolean | null;
  date: string | null;
  range: TimeRange | null;
  currency: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  available: boolean;
  limit: number;
  cursor: number;
  sort: 'default' | 'rating';
};

// Query values are strings; z.coerce would read '' as 0, so numbers go through a regex first.
const decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Use a number')
  .transform(Number);
const whole = z
  .string()
  .regex(/^\d+$/, 'Use a whole number')
  .transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

const isCurrency = (code: string) => {
  try {
    currencyExponent(code);
    return true;
  } catch {
    return false;
  }
};

const searchQuerySchema = z
  .object({
    lat: decimal.pipe(z.number().min(-90).max(90)),
    lng: decimal.pipe(z.number().min(-180).max(180)),
    radiusKm: decimal.pipe(z.number().gt(0).max(MAX_SEARCH_RADIUS_KM)),
    sport: z.enum(SPORTS),
    indoor: flag,
    date: isoDateSchema,
    from: timeSchema,
    to: timeSchema,
    currency: z.string().refine(isCurrency, 'Use an ISO 4217 currency code'),
    minPrice: whole,
    maxPrice: whole,
    available: flag,
    limit: whole.pipe(z.number().min(1).max(50)),
    cursor: whole,
    sort: z.literal('rating'),
  })
  .partial()
  .strict()
  .superRefine((q, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if ((q.lat === undefined) !== (q.lng === undefined)) issue('lng', 'Give lat and lng together');
    if (q.radiusKm !== undefined && q.lat === undefined) issue('radiusKm', 'A radius needs lat and lng');
    if ((q.from === undefined) !== (q.to === undefined)) issue('to', 'Give from and to together');
    if (q.from !== undefined && q.from === q.to) issue('to', 'from and to must differ');
    if ((q.minPrice !== undefined || q.maxPrice !== undefined) && q.currency === undefined) {
      issue('currency', 'A price range needs a currency');
    }
    if (q.minPrice !== undefined && q.maxPrice !== undefined && q.minPrice > q.maxPrice) {
      issue('maxPrice', 'maxPrice must be at least minPrice');
    }
  });

/** Validates the query string of GET /search; any problem is a 400 validation_error. */
export function parseSearchQuery(q: unknown): SearchQuery {
  const parsed = searchQuerySchema.safeParse(q);
  if (!parsed.success) throw new AppError(400, 'validation_error', 'Invalid search', parsed.error.flatten());
  const v = parsed.data;
  return {
    near: v.lat !== undefined && v.lng !== undefined ? { lat: v.lat, lng: v.lng } : null,
    radiusKm: v.radiusKm ?? null,
    sport: v.sport ?? null,
    indoor: v.indoor ?? null,
    date: v.date ?? null,
    range: v.from !== undefined && v.to !== undefined ? { start: v.from, end: v.to } : null,
    currency: v.currency ?? null,
    minPrice: v.minPrice ?? null,
    maxPrice: v.maxPrice ?? null,
    available: v.available ?? false,
    limit: v.limit ?? 20,
    cursor: v.cursor ?? 0,
    sort: v.sort ?? 'default',
  };
}
