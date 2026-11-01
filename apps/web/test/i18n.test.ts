import { describe, it, expect } from 'vitest';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';

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
});
