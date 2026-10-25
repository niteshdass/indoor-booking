import type { SeriesJson } from '@booking/shared';

export type { SeriesClashReason, SeriesDate, SeriesJson, SeriesPattern, SeriesPreview } from '@booking/shared';

/** One entry of `GET /me/series`: the series with its venue and court names. */
export type PlayerSeries = SeriesJson & {
  venue: { slug: string; name: string; timezone: string };
  turf: { name: string };
};
