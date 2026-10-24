import { describe, it, expect } from 'vitest';
import { SLUG_RE, isTimeZone, slugify } from '../src/venues';

describe('slugify', () => {
  it('transliterates and cleans', () => {
    expect(slugify('Арена Москва')).toBe('arena-moskva');
    expect(slugify('  Big  Turf!! #1 ')).toBe('big-turf-1');
    expect(slugify('Щука')).toBe('shchuka');
    expect(slugify('!!')).toBe('venue');
    const long = slugify('word '.repeat(20));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(SLUG_RE);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('isTimeZone', () => {
  it('accepts IANA zones and UTC only', () => {
    expect(isTimeZone('Asia/Dhaka')).toBe(true);
    expect(isTimeZone('Europe/Moscow')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Asia/Dhak')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('accepts current IANA names that ICU lists under old aliases', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('Europe/Kyiv')).toBe(true);
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
  });

  it('rejects abbreviations and offsets', () => {
    expect(isTimeZone('EST')).toBe(false);
    expect(isTimeZone('GMT')).toBe(false);
    expect(isTimeZone('+05:30')).toBe(false);
  });
});
