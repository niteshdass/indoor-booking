import { describe, it, expect } from 'vitest';
import { safeNext } from '../../src/auth/safeNext';

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/me/bookings?x=1')).toBe('/me/bookings?x=1');
  });
  it.each([null, '', '//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/\t/evil.com', '/\n/evil.com', '/\\/evil.com'])('rejects %s', (raw) => {
    expect(safeNext(raw)).toBe('/');
  });
});
