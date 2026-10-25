import { describe, it, expect } from 'vitest';
import { WEEKDAYS, addDays, weekdayOf, expandSeriesDates, SeriesPatternError, type SeriesPattern } from '../src';

const base: SeriesPattern = {
  weekdays: ['mon'],
  startTime: '18:00',
  slotCount: 1,
  firstDate: '2026-11-01',
  endDate: null,
  count: null,
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SeriesPatternError);
    return (e as SeriesPatternError).code;
  }
  return undefined;
}

describe('expandSeriesDates', () => {
  it('expands weekdays up to an end date', () => {
    const p = { ...base, weekdays: ['tue', 'fri'] as const, firstDate: '2026-11-03', endDate: '2026-11-13' };
    expect(expandSeriesDates({ ...p, weekdays: [...p.weekdays] }, '2026-11-01')).toEqual([
      '2026-11-03',
      '2026-11-06',
      '2026-11-10',
      '2026-11-13',
    ]);
  });

  it('count counts generated dates', () => {
    const p = { ...base, firstDate: '2026-11-04', count: 3 };
    expect(expandSeriesDates(p, '2026-11-01')).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  });

  it('accepts the 182-day edge and rejects 183', () => {
    const today = '2026-11-01';
    const edge = addDays(today, 182);
    const ok = { ...base, weekdays: [weekdayOf(edge)], firstDate: edge, endDate: edge };
    expect(expandSeriesDates(ok, today)).toEqual([edge]);
    const far = addDays(today, 183);
    const bad = { ...base, weekdays: [weekdayOf(far)], firstDate: today, count: 27 };
    expect(codeOf(() => expandSeriesDates(bad, today))).toBe('series_too_long');
    const bad2 = { ...base, weekdays: [weekdayOf(far)], firstDate: far, count: 1 };
    expect(codeOf(() => expandSeriesDates(bad2, today))).toBe('series_too_long');
  });

  it('rejects a far end date without looping long', () => {
    const p = { ...base, endDate: '9999-12-31' };
    expect(codeOf(() => expandSeriesDates(p, '2026-11-01'))).toBe('series_too_long');
  });

  it('rejects more than 100 dates', () => {
    const daily = { ...base, weekdays: [...WEEKDAYS], firstDate: '2026-11-01' };
    expect(codeOf(() => expandSeriesDates({ ...daily, count: 101 }, '2026-11-01'))).toBe('series_too_many_games');
    expect(expandSeriesDates({ ...daily, count: 100 }, '2026-11-01')).toHaveLength(100);
  });

  it('rejects a first date before today but allows today', () => {
    expect(codeOf(() => expandSeriesDates({ ...base, firstDate: '2026-10-31', count: 1 }, '2026-11-01'))).toBe(
      'series_past_start',
    );
    expect(expandSeriesDates({ ...base, weekdays: ['sun'], firstDate: '2026-11-01', count: 1 }, '2026-11-01')).toEqual([
      '2026-11-01',
    ]);
  });
});
