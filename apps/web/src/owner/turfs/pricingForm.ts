import { currencyExponent, isIsoDate, parseMoney, pricingConflict, type PricingRule, type TurfPricing } from '@booking/shared';

export type RuleKind = 'date' | 'weekend' | 'weekday';

export type RuleDraft = { kind: RuleKind; date: string; allDay: boolean; start: string; end: string; price: string };
export type PricingDraft = { base: string; rules: RuleDraft[] };

export const RULE_KINDS: readonly RuleKind[] = ['date', 'weekend', 'weekday'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minor units as an input string `parseMoney` accepts: no grouping, a dot, trailing zeros dropped. */
function minorToInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const digits = String(minor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

// `lang` is accepted for symmetry with the display helpers; input text stays locale-free so parseMoney can read it back.
export function draftFromPricing(p: TurfPricing | null, currency: string, _lang: string): PricingDraft {
  if (!p) return { base: '', rules: [] };
  return {
    base: minorToInput(p.base, currency),
    rules: p.rules.map((r) => ({
      kind: r.kind,
      date: r.kind === 'date' ? r.date : '',
      allDay: r.range === undefined,
      start: r.range?.start ?? '',
      end: r.range?.end ?? '',
      price: minorToInput(r.price, currency),
    })),
  };
}

function price(text: string, currency: string): number | null {
  try {
    return parseMoney(text.trim(), currency);
  } catch {
    return null;
  }
}

/** Field key to i18n key of its error. `rule.<i>.price|date|time`, `base`; an overlap is flagged on both rules' `range`. */
export function pricingFromDraft(
  d: PricingDraft,
  currency: string,
): { ok: true; pricing: TurfPricing } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const base = price(d.base, currency);
  if (base === null) errors.base = 'owner.pricing.err.price';

  const rules: PricingRule[] = [];
  d.rules.forEach((r, i) => {
    const p = price(r.price, currency);
    if (p === null) errors[`rule.${i}.price`] = 'owner.pricing.err.price';
    if (r.kind === 'date' && !isIsoDate(r.date)) errors[`rule.${i}.date`] = 'owner.pricing.err.date';
    if (!r.allDay && (!TIME_RE.test(r.start) || !TIME_RE.test(r.end))) errors[`rule.${i}.time`] = 'owner.pricing.err.time';
    const range = r.allDay ? {} : { range: { start: r.start, end: r.end } };
    rules.push(
      r.kind === 'date'
        ? { kind: 'date', date: r.date, ...range, price: p ?? 0 }
        : ({ kind: r.kind, ...range, price: p ?? 0 } as PricingRule),
    );
  });

  if (Object.keys(errors).length === 0) {
    const clash = pricingConflict(rules);
    if (clash) for (const i of clash) errors[`rule.${i}.range`] = 'owner.pricing.overlap';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, pricing: { base: base!, rules } };
}
