import { describe, it, expect } from 'vitest';
import {
  currencyExponent,
  parseMoney,
  formatMoney,
  percentOf,
  assertMinor,
  InvalidCurrencyError,
  InvalidMoneyError,
} from '../src/money';

describe('currencyExponent', () => {
  it('knows common exponents', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('BDT')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
  });
  it.each(['XYZ', 'usd', '', 'US'])('rejects %s', (c) => {
    expect(() => currencyExponent(c)).toThrow(InvalidCurrencyError);
  });
});

describe('parseMoney', () => {
  it('parses to minor units without float error', () => {
    expect(parseMoney('12.50', 'USD')).toBe(1250);
    expect(parseMoney('0.29', 'USD')).toBe(29);
    expect(parseMoney('1500', 'JPY')).toBe(1500);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
    expect(parseMoney('7', 'USD')).toBe(700);
  });
  it.each([
    ['10.555', 'USD'],
    ['10.5', 'JPY'],
    ['-1', 'USD'],
    ['abc', 'USD'],
    ['', 'USD'],
    ['1e3', 'USD'],
  ])('rejects %s %s', (v, c) => {
    expect(() => parseMoney(v, c)).toThrow(InvalidMoneyError);
  });
});

describe('percentOf', () => {
  it('rounds half up to whole minor units', () => {
    expect(percentOf(1000, 25)).toBe(250);
    expect(percentOf(999, 50)).toBe(500);
    expect(percentOf(1000, 0)).toBe(0);
    expect(percentOf(1000, 100)).toBe(1000);
  });
  it('rejects percent outside 0..100', () => {
    expect(() => percentOf(1000, -1)).toThrow(InvalidMoneyError);
    expect(() => percentOf(1000, 101)).toThrow(InvalidMoneyError);
  });
});

describe('assertMinor', () => {
  it.each([1.5, -1, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (v) => {
    expect(() => assertMinor(v)).toThrow(InvalidMoneyError);
  });
});

describe('formatMoney', () => {
  it('formats using currency exponent', () => {
    expect(formatMoney(1250, 'USD', 'en-US')).toBe('$12.50');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });
});
