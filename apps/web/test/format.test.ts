import { describe, it, expect, beforeAll } from 'vitest';

type Format = typeof import('../src/lib/format');
let f: Format;

// The process zone must differ from every venue zone used below, and must be set before Intl first resolves it.
beforeAll(async () => {
  process.env.TZ = 'America/Los_Angeles';
  f = await import('../src/lib/format');
});

describe('format', () => {
  it('formatTime uses the venue zone', () => {
    expect(f.formatTime('2026-01-01T12:00:00.000Z', 'Asia/Dhaka', 'en')).toBe('18:00');
  });
  it('money handles zero- and three-decimal currencies', () => {
    expect(f.money(1500, 'JPY', 'en')).toContain('1,500');
    expect(f.money(1500, 'KWD', 'en')).toContain('1.500');
  });
  it('moneyShort drops the fraction only when it is zero', () => {
    expect(f.moneyShort(200_000, 'BDT', 'en')).toBe('BDT\u00a02,000');
    expect(f.moneyShort(200_050, 'BDT', 'en')).toBe('BDT\u00a02,000.50');
    expect(f.moneyShort(1500, 'KWD', 'en')).toBe('KWD\u00a01.500');
  });
  it('moneyCompact abbreviates from a million so a KPI fits its card', () => {
    expect(f.moneyCompact(200_000, 'BDT', 'en')).toBe('BDT 2,000');
    expect(f.moneyCompact(3_381_905_000, 'BDT', 'en')).toBe('BDT 33.8M');
    expect(f.moneyCompact(3_381_905_000, 'BDT', 'ru')).toMatch(/^33,8\s*млн/);
  });
  it('formatDistance', () => {
    expect(f.formatDistance(850, 'en')).toBe('850 m');
    expect(f.formatDistance(12_345, 'en')).toBe('12.3 km');
  });
  it('formatDate reads a bare date as that calendar date', () => {
    expect(f.formatDate('2026-01-01', 'Pacific/Kiritimati', 'en')).toContain('Jan 1');
  });
  it('formatDate converts an instant into the venue zone', () => {
    expect(f.formatDate('2026-01-01T23:30:00.000Z', 'Asia/Dhaka', 'en')).toContain('Jan 2');
  });
  it('writes Bangla digits for bn', () => {
    expect(f.formatTime('2026-01-01T12:00:00.000Z', 'Asia/Dhaka', 'bn')).toMatch(/১৮:০০|৬:০০/);
    expect(f.moneyShort(150_000, 'BDT', 'bn')).toContain('১,৫০০');
    expect(f.formatDistance(12_345, 'bn')).toContain('১২.৩');
    expect(f.formatDate('2026-01-01', 'Asia/Dhaka', 'bn')).toContain('১');
  });
});
