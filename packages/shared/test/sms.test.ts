import { describe, it, expect } from 'vitest';
import { isBdNumber, smsSegments } from '../src/sms';

describe('smsSegments', () => {
  it('counts GSM-7 text at 160 for one part and 153 per part after', () => {
    expect(smsSegments('')).toBe(0);
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    expect(smsSegments('a'.repeat(306))).toBe(2);
    expect(smsSegments('a'.repeat(307))).toBe(3);
  });
  it('counts extension characters as two septets', () => {
    expect(smsSegments('€'.repeat(80))).toBe(1);
    expect(smsSegments('€'.repeat(81))).toBe(2);
  });
  it('counts Bangla and Russian as UCS-2 at 70 and 67', () => {
    expect(smsSegments('я'.repeat(70))).toBe(1);
    expect(smsSegments('я'.repeat(71))).toBe(2);
    expect(smsSegments('আ'.repeat(134))).toBe(2);
    expect(smsSegments('আ'.repeat(135))).toBe(3);
    // One non-GSM character turns the whole message UCS-2.
    expect(smsSegments(`${'a'.repeat(100)}я`)).toBe(2);
  });
  it('counts emoji in UTF-16 units', () => {
    expect(smsSegments('😀'.repeat(35))).toBe(1);
    expect(smsSegments('😀'.repeat(36))).toBe(2);
  });
});

describe('isBdNumber', () => {
  it('accepts +8801 mobile numbers only', () => {
    expect(isBdNumber('+8801712345678')).toBe(true);
    expect(isBdNumber('+880171234567')).toBe(false);
    expect(isBdNumber('+8802712345678')).toBe(false);
    expect(isBdNumber('+15551234567')).toBe(false);
  });
});
