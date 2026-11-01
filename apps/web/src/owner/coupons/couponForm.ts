import { COUPON_CODE_PATTERN, normalizeCouponCode, parseMoney, type CouponJson, type CouponType } from '@booking/shared';
import { minorToInput } from '../addons/addonForm';

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

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar date of an instant in the browser's zone, as a date field value. */
export function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A date field value as an instant: the start of that day (`from`) or its last millisecond (`until`), in the
 * browser's zone. Owners pick whole days, so "until Nov 30" keeps the code usable all of Nov 30; the browser's
 * zone is the owner's own clock, which is close enough for a promo window.
 */
export function dateInputToIso(date: string, edge: 'from' | 'until'): string {
  return new Date(`${date}T${edge === 'from' ? '00:00:00.000' : '23:59:59.999'}`).toISOString();
}

export function draftFromCoupon(c: CouponJson): CouponDraft {
  return {
    code: c.code,
    type: c.type,
    value: c.type === 'percent' ? String(c.value) : minorToInput(c.value, c.currency),
    maxDiscount: c.maxDiscount === null ? '' : minorToInput(c.maxDiscount, c.currency),
    minSubtotal: c.minSubtotal === 0 ? '' : minorToInput(c.minSubtotal, c.currency),
    validFrom: isoToDateInput(c.validFrom),
    validUntil: isoToDateInput(c.validUntil),
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

function fullBody(d: CouponDraft, currency: string): { ok: true; body: Body } | { ok: false; errors: Record<string, string> } {
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

  const validFrom = DATE_RE.test(d.validFrom) ? dateInputToIso(d.validFrom, 'from') : null;
  const validUntil = DATE_RE.test(d.validUntil) ? dateInputToIso(d.validUntil, 'until') : null;
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
): { ok: true; body: object } | { ok: false; errors: Record<string, string> } {
  const next = fullBody(d, currency);
  if (!next.ok || original === null) return next;
  const prev = fullBody(draftFromCoupon(original), currency);
  if (!prev.ok) return next;
  const body: Record<string, unknown> = {};
  for (const k of Object.keys(next.body) as (keyof Body)[]) {
    if (JSON.stringify(next.body[k]) !== JSON.stringify(prev.body[k])) body[k] = next.body[k];
  }
  return { ok: true, body };
}
