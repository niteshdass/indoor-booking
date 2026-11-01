import { describe, it, expect } from 'vitest';
import { COUPON_CODE_PATTERN, couponDiscount, normalizeCouponCode, splitDiscount } from '../src/coupons';

describe('couponDiscount', () => {
  const terms = { maxDiscount: null, minSubtotal: 0 };
  it('takes a percent of the base, rounded like percentOf', () => {
    expect(couponDiscount({ ...terms, type: 'percent', value: 10 }, 3800)).toBe(380);
    expect(couponDiscount({ ...terms, type: 'percent', value: 12.5 }, 1001)).toBe(125);
  });
  it('caps a percent coupon at maxDiscount', () => {
    expect(couponDiscount({ ...terms, type: 'percent', value: 50, maxDiscount: 1000 }, 5000)).toBe(1000);
  });
  it('takes a fixed amount, never more than the base', () => {
    expect(couponDiscount({ ...terms, type: 'fixed', value: 500 }, 3800)).toBe(500);
    expect(couponDiscount({ ...terms, type: 'fixed', value: 5000 }, 3800)).toBe(3800);
    // maxDiscount only caps percent coupons.
    expect(couponDiscount({ ...terms, type: 'fixed', value: 500, maxDiscount: 100 }, 3800)).toBe(500);
  });
});

describe('splitDiscount', () => {
  it('splits in proportion and sums to the discount', () => {
    expect(splitDiscount(1000, [3000, 1000])).toEqual([750, 250]);
    const shares = splitDiscount(100, [1000, 1000, 1000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
  });
  it('never passes a booking base', () => {
    expect(splitDiscount(10, [5, 5])).toEqual([5, 5]);
    expect(splitDiscount(3, [0, 3])).toEqual([0, 3]);
  });
  it('is zero for nothing to discount', () => {
    expect(splitDiscount(0, [100, 200])).toEqual([0, 0]);
    expect(splitDiscount(50, [0, 0])).toEqual([0, 0]);
  });
});

describe('coupon codes', () => {
  it('are upper-cased and trimmed', () => {
    expect(normalizeCouponCode('  summer-10 ')).toBe('SUMMER-10');
  });
  it('allow 3 to 24 letters, digits, - and _', () => {
    expect(COUPON_CODE_PATTERN.test('EID_25')).toBe(true);
    expect(COUPON_CODE_PATTERN.test('AB')).toBe(false);
    expect(COUPON_CODE_PATTERN.test('HAS SPACE')).toBe(false);
    expect(COUPON_CODE_PATTERN.test('A'.repeat(25))).toBe(false);
  });
});
