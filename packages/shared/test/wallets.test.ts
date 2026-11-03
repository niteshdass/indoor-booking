import { describe, it, expect } from 'vitest';
import { bdMobileDigits, formatBdMobile, normalizeTrxId, PROVIDER_NAMES, TRX_ID_PATTERN, WALLET_PROVIDERS } from '../src/wallets';
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

describe('wallet display helpers', () => {
  it('reads a Bangladesh mobile number in either form', () => {
    expect(bdMobileDigits('01712-345 678')).toBe('1712345678');
    expect(bdMobileDigits('+8801712345678')).toBe('1712345678');
    expect(bdMobileDigits('0123')).toBeNull();
  });
  it('formats a wallet number for display, else shows it as typed', () => {
    expect(formatBdMobile('01712345678')).toBe('+880 1712-345678');
    expect(formatBdMobile('12345')).toBe('12345');
    expect(PROVIDER_NAMES.bkash).toBe('bKash');
  });
});
