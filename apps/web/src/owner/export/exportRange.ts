import { addDays, isIsoDate } from '@booking/shared';
import { ownerPath } from '../ownerApi';

export const EXPORT_KINDS = ['bookings', 'payments'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Longest range one file may cover, inclusive (same as the API). */
export const EXPORT_MAX_DAYS = 366;
/** Days the dialog covers when the page has no range of its own. */
export const EXPORT_DEFAULT_DAYS = 30;

export type ExportRange = { from: string; to: string };

/**
 * The range the dialog opens on: the page's own range when it has one (a missing end is filled in), else the last
 * `days` days ending `today` (venue-local).
 */
export function initialRange(today: string, page: { from?: string | null; to?: string | null; days?: number } = {}): ExportRange {
  const days = page.days ?? EXPORT_DEFAULT_DAYS;
  const { from, to } = page;
  if (from && to) return { from, to };
  if (from) return { from, to: from > today ? from : today };
  if (to) return { from: addDays(to, -(days - 1)), to };
  return { from: addDays(today, -(days - 1)), to: today };
}

export type RangeErrors = { from?: 'owner.export.err.date'; to?: 'owner.export.err.date' | 'owner.export.err.order' | 'owner.export.err.tooLong' };

/** Inline field errors for a range, as i18n keys; empty when the API would take it. */
export function rangeErrors({ from, to }: ExportRange): RangeErrors {
  const errors: RangeErrors = {};
  if (!isIsoDate(from)) errors.from = 'owner.export.err.date';
  if (!isIsoDate(to)) errors.to = 'owner.export.err.date';
  if (errors.from || errors.to) return errors;
  if (to < from) return { to: 'owner.export.err.order' };
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > EXPORT_MAX_DAYS) return { to: 'owner.export.err.tooLong' };
  return errors;
}

/** The CSV endpoint; no `venueId` exports every venue the member can see. */
export function exportPath(ownerId: string, kind: ExportKind, venueId: string | null, range: ExportRange): string {
  const p = new URLSearchParams();
  if (venueId) p.set('venueId', venueId);
  p.set('from', range.from);
  p.set('to', range.to);
  return ownerPath(ownerId, `/reports/${kind}.csv?${p.toString()}`);
}
