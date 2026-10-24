import { describe, it, expect } from 'vitest';
import {
  isIsoDate,
  weekdayOf,
  addDays,
  hmToMin,
  rangeMinutes,
  localToUtc,
  localParts,
} from '../src/time';

describe('date helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-30')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '26-10-30', '']) expect(isIsoDate(bad)).toBe(false);
  });
  it('weekday and addDays', () => {
    expect(weekdayOf('2026-10-30')).toBe('fri');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('minutes', () => {
  it('hmToMin', () => {
    expect(hmToMin('01:30')).toBe(90);
  });
  it('rangeMinutes wraps past midnight', () => {
    expect(rangeMinutes({ start: '16:00', end: '02:00' })).toEqual([960, 1560]);
    expect(rangeMinutes({ start: '08:00', end: '08:00' })).toEqual([480, 1920]);
    expect(rangeMinutes({ start: '08:00', end: '09:00' })).toEqual([480, 540]);
  });
});

describe('localToUtc', () => {
  it('converts fixed-offset zones', () => {
    expect(localToUtc('2026-10-30', 960, 'Asia/Dhaka').toISOString()).toBe('2026-10-30T10:00:00.000Z');
    expect(localToUtc('2026-10-30', 1500, 'Asia/Dhaka').toISOString()).toBe('2026-10-30T19:00:00.000Z');
  });
  it('moves a skipped time after the gap', () => {
    expect(localToUtc('2026-03-29', 90, 'Europe/London').toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('takes the earlier instant for a repeated time', () => {
    expect(localToUtc('2026-10-25', 90, 'Europe/London').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('localParts', () => {
  it('gives local date and time', () => {
    expect(localParts(new Date('2026-10-30T19:00:00Z'), 'Asia/Dhaka')).toEqual({ date: '2026-10-31', hm: '01:00' });
  });
});
