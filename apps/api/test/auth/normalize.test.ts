import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizePhone } from '../../src/auth/normalize';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail(' Ana@X.com ')).toBe('ana@x.com');
  });
  it('rejects invalid email', () => {
    expect(() => normalizeEmail('nope')).toThrow(expect.objectContaining({ code: 'invalid_email' }));
  });
});

describe('normalizePhone', () => {
  it('normalizes formatting variants to E.164', () => {
    expect(normalizePhone('+880 1712-345678')).toBe('+8801712345678');
    expect(normalizePhone('+7 912 345-67-89')).toBe('+79123456789');
  });
  it('rejects local number without country code', () => {
    expect(() => normalizePhone('01712345678')).toThrow(
      expect.objectContaining({ code: 'invalid_phone' }),
    );
  });
  it('rejects invalid number', () => {
    expect(() => normalizePhone('+1 123')).toThrow(expect.objectContaining({ code: 'invalid_phone' }));
  });
});
