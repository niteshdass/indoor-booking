import { randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newReference(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
