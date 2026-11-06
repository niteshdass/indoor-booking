// Ported from apps/web/src/owner/coupons/couponForm.ts: same validation and the same POST / PATCH-diff bodies.
import { addDays, COUPON_CODE_PATTERN, currencyExponent, localParts, localToUtc, normalizeCouponCode, parseMoney, type CouponJson, type CouponType } from '@booking/shared';

/** Minor units as a fixed-decimals input value ("300.00"), as the web add-on and coupon forms show them. */
export function minorToInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

export type CouponDraft = {
  code: string;
  type: CouponType;
  /** A percent ("10", "12.5") or an amount in major units ("300.00"), by `type`. */
  value: string;
  maxDiscount: string;
  minSubtotal: string;
  /** YYYY-MM-DD from a date field; blank: no start or no end. */
  validFrom: string;
  validUntil: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  allVenues: boolean;
  venueIds: string[];
  active: boolean;
};

export const CODE_MAX = 24;
const INT_RE = /^\d+$/;
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const EMPTY_COUPON_DRAFT: CouponDraft = {
  code: '',
  type: 'percent',
  value: '',
  maxDiscount: '',
  minSubtotal: '',
  validFrom: '',
  validUntil: '',
  maxUses: '',
  maxUsesPerCustomer: '',
  allVenues: true,
  venueIds: [],
  active: true,
};

/**
 * The zone a promo's whole days are counted in: the venues', since that is where players use the code.
 * Owners run venues in one market, so the first venue stands for all; with none yet, the device's zone.
 */
export function couponZone(venues: { id: string; timezone: string }[], venueIds: string[] = []): string {
  const chosen = venues.find((v) => venueIds.includes(v.id)) ?? venues[0];
  return chosen?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The calendar date of an instant in `timeZone`, as a date field value. */
export function isoToDateInput(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  return localParts(new Date(iso), timeZone).date;
}

/**
 * A date field value as an instant: the start of that day (`from`) or its last millisecond (`until`), in
 * `timeZone`. Owners pick whole days, so "until Nov 30" keeps the code usable all of Nov 30 at the venue.
 */
export function dateInputToIso(date: string, edge: 'from' | 'until', timeZone: string): string {
  if (edge === 'from') return localToUtc(date, 0, timeZone).toISOString();
  return new Date(localToUtc(addDays(date, 1), 0, timeZone).getTime() - 1).toISOString();
}

export function draftFromCoupon(c: CouponJson, timeZone: string): CouponDraft {
  return {
    code: c.code,
    type: c.type,
    value: c.type === 'percent' ? String(c.value) : minorToInput(c.value, c.currency),
    maxDiscount: c.maxDiscount === null ? '' : minorToInput(c.maxDiscount, c.currency),
    minSubtotal: c.minSubtotal === 0 ? '' : minorToInput(c.minSubtotal, c.currency),
    validFrom: isoToDateInput(c.validFrom, timeZone),
    validUntil: isoToDateInput(c.validUntil, timeZone),
    maxUses: c.maxUses === null ? '' : String(c.maxUses),
    maxUsesPerCustomer: c.maxUsesPerCustomer === null ? '' : String(c.maxUsesPerCustomer),
    allVenues: c.venueIds.length === 0,
    venueIds: c.venueIds,
    active: c.active,
  };
}

type Body = {
  code: string;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  venueIds: string[];
  active: boolean;
};

/** Blank: null; else a whole number in [min, max], or NaN. */
function optionalInt(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (s === '') return null;
  const n = INT_RE.test(s) ? Number(s) : NaN;
  return n >= min && n <= max ? n : NaN;
}

/** Blank: null; else minor units, or NaN. */
function optionalMoney(text: string, currency: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  try {
    return parseMoney(s, currency);
  } catch {
    return NaN;
  }
}

function fullBody(d: CouponDraft, currency: string, timeZone: string): { ok: true; body: Body } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const code = normalizeCouponCode(d.code);
  if (!COUPON_CODE_PATTERN.test(code)) errors.code = 'owner.coupons.err.code';

  let value: number;
  if (d.type === 'percent') {
    const s = d.value.trim();
    value = PERCENT_RE.test(s) ? Number(s) : NaN;
    if (!(value > 0 && value <= 100)) errors.value = 'owner.coupons.err.percent';
  } else {
    value = optionalMoney(d.value, currency) ?? NaN;
    if (!(value > 0)) errors.value = 'owner.coupons.err.amount';
  }

  // Only a percent coupon can have a cap; the API wants null on a fixed one.
  const maxDiscount = d.type === 'percent' ? optionalMoney(d.maxDiscount, currency) : null;
  if (maxDiscount !== null && !(maxDiscount > 0)) errors.maxDiscount = 'owner.coupons.err.amountOrBlank';
  const minSubtotal = optionalMoney(d.minSubtotal, currency) ?? 0;
  if (Number.isNaN(minSubtotal)) errors.minSubtotal = 'owner.coupons.err.amountOrBlank';

  const validFrom = DATE_RE.test(d.validFrom) ? dateInputToIso(d.validFrom, 'from', timeZone) : null;
  const validUntil = DATE_RE.test(d.validUntil) ? dateInputToIso(d.validUntil, 'until', timeZone) : null;
  if (validFrom && validUntil && validUntil <= validFrom) errors.validUntil = 'owner.coupons.err.dates';

  const maxUses = optionalInt(d.maxUses, 1, 1_000_000);
  if (Number.isNaN(maxUses)) errors.maxUses = 'owner.coupons.err.maxUses';
  const maxUsesPerCustomer = optionalInt(d.maxUsesPerCustomer, 1, 1000);
  if (Number.isNaN(maxUsesPerCustomer)) errors.maxUsesPerCustomer = 'owner.coupons.err.maxUsesPerCustomer';

  if (!d.allVenues && d.venueIds.length === 0) errors.venues = 'owner.coupons.err.venues';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      code,
      type: d.type,
      value,
      maxDiscount,
      minSubtotal,
      validFrom,
      validUntil,
      maxUses,
      maxUsesPerCustomer,
      venueIds: d.allVenues ? [] : [...d.venueIds].sort(),
      active: d.active,
    },
  };
}

/**
 * The POST body (original null) or the PATCH body (only the keys that changed; `{}` when nothing did).
 * Errors map a field to the i18n key of its message. On edit the stored coupon goes through the same
 * draft round trip, so an untouched date is never re-sent with a shifted time.
 */
export function couponBody(
  d: CouponDraft,
  original: CouponJson | null,
  currency: string,
  timeZone: string,
): { ok: true; body: object } | { ok: false; errors: Record<string, string> } {
  const next = fullBody(d, currency, timeZone);
  if (!next.ok || original === null) return next;
  const prev = fullBody(draftFromCoupon(original, timeZone), currency, timeZone);
  if (!prev.ok) return next;
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(next.body) as (keyof Body)[]) {
    if (JSON.stringify(next.body[k]) !== JSON.stringify(prev.body[k])) body[k] = next.body[k];
  }
  return { ok: true, body };
}

export type CouponState = { key: 'off' | 'expired' | 'usedUp' | 'scheduled' | 'active'; tone: 'neutral' | 'warning' | 'info' | 'success' };

/** What a player trying the code would meet now: off, not started, ended, used up, or live (web `state`). */
export function couponState(c: CouponJson, now: number): CouponState {
  if (!c.active) return { key: 'off', tone: 'neutral' };
  if (c.validUntil && Date.parse(c.validUntil) <= now) return { key: 'expired', tone: 'neutral' };
  if (c.maxUses !== null && c.uses >= c.maxUses) return { key: 'usedUp', tone: 'warning' };
  if (c.validFrom && Date.parse(c.validFrom) > now) return { key: 'scheduled', tone: 'info' };
  return { key: 'active', tone: 'success' };
}
