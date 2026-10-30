import { describe, it, expect } from 'vitest';
import { normalizeTrxId, TRX_ID_PATTERN, WALLET_PROVIDERS } from '../src/wallets';
import { MANUAL_HOLD_MINUTES } from '../src/booking';

describe('normalizeTrxId', () => {
  it('trims, strips inner spaces and uppercases', () => {
    expect(normalizeTrxId(' 9a1b 2c3d4e ')).toBe('9A1B2C3D4E');
  });
  it('rejects too short, too long and non-alphanumeric ids', () => {
    expect(normalizeTrxId('AB12')).toBeNull();
    expect(normalizeTrxId('ABCDEFGHIJKLM')).toBeNull();
    expect(normalizeTrxId('AB-12345678')).toBeNull();
  });
  it('exposes the pattern, providers and hold', () => {
    expect(TRX_ID_PATTERN.test('ABCD1234')).toBe(true);
    expect(WALLET_PROVIDERS).toEqual(['bkash', 'nagad', 'rocket']);
    expect(MANUAL_HOLD_MINUTES).toBe(15);
  });
});
