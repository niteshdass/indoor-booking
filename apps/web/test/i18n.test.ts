import { describe, it, expect } from 'vitest';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import bn from '../src/i18n/locales/bn.json';

function flatten(obj: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') for (const [ck, cv] of flatten(v as Record<string, unknown>, key)) out.set(ck, cv);
    else out.set(key, v);
  }
  return out;
}
const base = (key: string) => key.replace(/_(one|few|many|other|zero|two)$/, '');
const baseKeys = (m: Map<string, unknown>) => new Set([...m.keys()].map(base));
/** {{placeholders}}, <tags> and $t() nesting, sorted: what a translation must carry over unchanged. */
const tokens = (v: unknown) => (String(v).match(/{{\s*[\w.]+\s*}}|<\/?\w+\/?>|\$t\([^)]*\)/g) ?? []).sort();
/** The en value a translated key answers to: bn has only one/other, so any plural form maps to en's _other. */
const enValue = (e: Map<string, unknown>, key: string) => e.get(key) ?? e.get(`${base(key)}_other`);

describe('i18n locales', () => {
  const e = flatten(en);
  const r = flatten(ru);
  it('en and ru have the same keys (ignoring plural suffixes)', () => {
    const eb = baseKeys(e);
    const rb = baseKeys(r);
    expect([...eb].filter((k) => !rb.has(k))).toEqual([]);
    expect([...rb].filter((k) => !eb.has(k))).toEqual([]);
  });
  it('every ru value is a non-empty string', () => {
    for (const [k, v] of r) expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true);
  });
  // ru calls a venue «площадка» and a turf «поле»; mixing in «корт» or reusing «площадка» for a turf confuses the two.
  it('ru turf labels say поле and never reuse the venue word', () => {
    for (const [k, v] of r) expect(/корт/iu.test(String(v)), k).toBe(false);
    for (const [k, v] of r) {
      if (!/(^|\.)turf$/.test(k)) continue;
      expect(String(v), k).toMatch(/(?<![а-яё])поле(?![а-яё])/iu);
    }
  });
  it('every ru value carries the en placeholders and tags', () => {
    for (const [k, v] of r) expect(tokens(v), k).toEqual(tokens(enValue(e, k)));
  });
});

describe('bn locale', () => {
  const e = flatten(en);
  const b = flatten(bn);
  it('has the same keys as en (ignoring plural suffixes)', () => {
    const eb = baseKeys(e);
    const bb = baseKeys(b);
    expect([...eb].filter((k) => !bb.has(k))).toEqual([]);
    expect([...bb].filter((k) => !eb.has(k))).toEqual([]);
  });
  it('every value is a non-empty string with the en placeholders and tags', () => {
    for (const [k, v] of b) {
      expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true);
      expect(tokens(v), k).toEqual(tokens(enValue(e, k)));
    }
  });
  // Bangla must stay inside the 30% length budget the layouts are built for (design-system.md "Russian fits").
  it('runs no more than 30% longer than en overall', () => {
    let enLength = 0;
    let bnLength = 0;
    for (const [k, v] of b) {
      enLength += String(enValue(e, k)).length;
      bnLength += String(v).length;
    }
    expect(bnLength / enLength).toBeLessThanOrEqual(1.3);
  });
  // bn calls a venue «ভেন্যু» and a turf «মাঠ»; reusing the venue word for a turf confuses the two.
  it('turf labels say মাঠ', () => {
    for (const [k, v] of b) {
      if (!/(^|\.)turf$/.test(k)) continue;
      expect(String(v), k).toContain('মাঠ');
      expect(String(v), k).not.toContain('ভেন্যু');
    }
  });
});
