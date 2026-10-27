import { describe, expect, it } from 'vitest';
import { countryOptions, currencyOptions, timeZoneOptions } from '../src/lib/regions';

describe('region options', () => {
  it('lists countries by their name in the language', () => {
    const en = countryOptions('en');
    expect(en.length).toBeGreaterThan(240);
    expect(en.find((o) => o.value === 'BD')!.label).toBe('Bangladesh');
    expect(countryOptions('ru').find((o) => o.value === 'BD')!.label).toBe('Бангладеш');
    const labels = en.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('lists currencies with their names', () => {
    const bdt = currencyOptions('en').find((o) => o.value === 'BDT')!;
    expect(bdt.label).toBe('BDT · Bangladeshi Taka');
  });

  it('lists current zone names with their offset', () => {
    const zones = timeZoneOptions('', new Date('2026-01-15T00:00:00Z'));
    const values = zones.map((o) => o.value);
    expect(values).toContain('Asia/Kolkata');
    expect(values).not.toContain('Asia/Calcutta');
    expect(zones.find((o) => o.value === 'Asia/Dhaka')!.label).toBe('Asia/Dhaka (GMT+6)');
    expect(zones.find((o) => o.value === 'America/New_York')!.label).toBe('America/New York (GMT-5)');
  });

  it('keeps a saved value the list does not know', () => {
    expect(currencyOptions('en', 'XYZ')[0]).toEqual({ value: 'XYZ', label: 'XYZ' });
  });
});
