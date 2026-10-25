import { currencyExponent, parseMoney, type AddonPricingType, type AutoApplyRule } from '@booking/shared';
import type { Addon } from '../types';

export type AddonDraft = {
  name: string;
  pricingType: AddonPricingType;
  price: string;
  maxQuantity: string;
  stock: string;
  autoApply: boolean;
  autoAllDay: boolean;
  autoStart: string;
  autoEnd: string;
  outdoorOnly: boolean;
};

export const NAME_MAX = 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const INT_RE = /^\d+$/;

export const EMPTY_ADDON_DRAFT: AddonDraft = {
  name: '',
  pricingType: 'per_booking',
  price: '',
  maxQuantity: '1',
  stock: '',
  autoApply: false,
  autoAllDay: true,
  autoStart: '',
  autoEnd: '',
  outdoorOnly: false,
};

/** Minor units as an editable decimal string ("12.50", or "1200" for a 0-decimal currency). */
export function minorToInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

export function draftFromAddon(a: Addon): AddonDraft {
  return {
    name: a.name,
    pricingType: a.pricingType,
    price: minorToInput(a.price, a.currency),
    maxQuantity: String(a.maxQuantity),
    stock: a.stock === null ? '' : String(a.stock),
    autoApply: a.autoApply !== null,
    autoAllDay: a.autoApply?.range === undefined,
    autoStart: a.autoApply?.range?.start ?? '',
    autoEnd: a.autoApply?.range?.end ?? '',
    outdoorOnly: a.autoApply?.outdoorOnly ?? false,
  };
}

/**
 * The POST body (original null) or the PATCH body (only the keys that changed; `{}` when nothing did).
 * Errors map a field to the i18n key of its message. Auto-apply needs a per-booking or per-hour add-on with
 * unlimited stock, as the API requires. `end <= start` in an auto-apply range ends the next day, so it is never an error.
 */
export function addonBody(
  d: AddonDraft,
  original: Addon | null,
  currency: string,
): { ok: true; body: object } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const name = d.name.trim();
  if (name === '' || name.length > NAME_MAX) errors.name = 'owner.addons.err.name';

  let price = 0;
  try {
    price = parseMoney(d.price.trim(), currency);
  } catch {
    errors.price = 'owner.addons.err.price';
  }

  const qty = d.maxQuantity.trim();
  const maxQuantity = INT_RE.test(qty) ? Number(qty) : NaN;
  if (!(maxQuantity >= 1 && maxQuantity <= 99)) errors.maxQuantity = 'owner.addons.err.maxQuantity';

  const stockText = d.stock.trim();
  const stock = stockText === '' ? null : INT_RE.test(stockText) ? Number(stockText) : NaN;
  if (stock !== null && !(stock >= 0 && stock <= 9999)) errors.stock = 'owner.addons.err.stock';

  let autoApply: AutoApplyRule | null = null;
  if (d.autoApply) {
    if (d.pricingType === 'per_unit' || stockText !== '') errors.autoApply = 'owner.addons.autoConflict';
    if (d.autoAllDay) {
      autoApply = { outdoorOnly: d.outdoorOnly };
    } else {
      if (!TIME_RE.test(d.autoStart) || !TIME_RE.test(d.autoEnd)) errors.autoRange = 'owner.addons.err.time';
      autoApply = { range: { start: d.autoStart, end: d.autoEnd }, outdoorOnly: d.outdoorOnly };
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const next = { name, pricingType: d.pricingType, price, maxQuantity, stock, autoApply };
  if (original === null) {
    return {
      ok: true,
      body: { name, pricingType: d.pricingType, price, maxQuantity, stock, ...(autoApply ? { autoApply } : {}) },
    };
  }
  const same = <K extends keyof typeof next>(k: K) => JSON.stringify(next[k]) === JSON.stringify(original[k]);
  const body: Record<string, unknown> = {};
  for (const k of ['name', 'pricingType', 'price', 'maxQuantity', 'stock', 'autoApply'] as const) {
    if (!same(k)) body[k] = next[k];
  }
  return { ok: true, body };
}
