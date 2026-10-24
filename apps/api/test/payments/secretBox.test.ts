import { describe, it, expect } from 'vitest';
import { seal, open } from '../../src/payments/secretBox';

const key = Buffer.alloc(32, 7);
const aad = 'ownerA:stripe';
const fail = 'Cannot open sealed value';

function flip(part: string): string {
  return (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
}
function tamper(sealed: string, index: 1 | 2 | 3): string {
  const parts = sealed.split('.');
  parts[index] = flip(parts[index]!);
  return parts.join('.');
}

describe('secretBox', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = seal('sk_test_secret', key, aad);
    expect(open(a, key, aad)).toBe('sk_test_secret');
    expect(seal('sk_test_secret', key, aad)).not.toBe(a);
  });
  it('is versioned and hides the plain text', () => {
    const a = seal('sk_test_secret', key, aad);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('sk_test_secret');
  });
  it.each([
    ['iv', (s: string) => tamper(s, 1)],
    ['tag', (s: string) => tamper(s, 2)],
    ['ciphertext', (s: string) => tamper(s, 3)],
    ['version', (s: string) => s.replace(/^v1\./, 'v2.')],
  ])('rejects a tampered %s', (_n, mutate) => {
    expect(() => open(mutate(seal('x', key, aad)), key, aad)).toThrow(fail);
  });
  it('rejects the wrong key and the wrong AAD', () => {
    const a = seal('x', key, aad);
    expect(() => open(a, Buffer.alloc(32, 8), aad)).toThrow(fail);
    expect(() => open(a, key, 'ownerB:stripe')).toThrow(fail);
  });
  it('rejects garbage', () => {
    expect(() => open('nonsense', key, aad)).toThrow(fail);
  });
});
