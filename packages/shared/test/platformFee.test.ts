import { describe, it, expect } from 'vitest';
import { DEFAULT_PLATFORM_FEE, platformFeeFor, type PlatformFeeSettings } from '../src/platformFee';

const fixed = (n: number, payer: 'owner' | 'player' = 'owner'): PlatformFeeSettings => ({
  mode: 'fixed', fixed: n, percent: null, payer,
});
const pct = (n: number): PlatformFeeSettings => ({ mode: 'percent', fixed: null, percent: n, payer: 'owner' });

describe('platformFeeFor', () => {
  it('free mode gives null', () => {
    expect(platformFeeFor({ ...DEFAULT_PLATFORM_FEE }, 100000, 'BDT')).toBeNull();
  });
  it('fixed fee follows the currency exponent', () => {
    expect(platformFeeFor(fixed(50, 'player'), 100000, 'BDT')).toEqual({
      mode: 'fixed', value: 50, payer: 'player', amount: 5000,
    });
    expect(platformFeeFor(fixed(12.5), 100000, 'JPY')?.amount).toBe(13);
    expect(platformFeeFor(fixed(1), 100000, 'KWD')?.amount).toBe(1000);
  });
  it('percent rounds half up', () => {
    expect(platformFeeFor(pct(5), 100000, 'BDT')).toEqual({
      mode: 'percent', value: 5, payer: 'owner', amount: 5000,
    });
    expect(platformFeeFor(pct(2.5), 333, 'BDT')?.amount).toBe(8);
  });
  it('gives no fee when it rounds to zero', () => {
    expect(platformFeeFor(pct(1), 10, 'BDT')).toBeNull();
    expect(platformFeeFor(pct(5), 0, 'BDT')).toBeNull();
  });
});
