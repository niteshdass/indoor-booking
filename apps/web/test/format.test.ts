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
});
