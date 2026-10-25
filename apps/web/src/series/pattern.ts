import { useEffect } from 'react';
import { addDays, weekdayOf } from '@booking/shared';
import type { SeriesPattern } from './types';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A fresh pattern: the weekday of `firstDate`, one slot, ten games. The start time is picked once slots load. */
export function defaultPattern(firstDate: string): SeriesPattern {
  return { weekdays: [weekdayOf(firstDate)], startTime: '', slotCount: 1, firstDate, endDate: null, count: 10 };
}

/** The tomorrow-based first date both builders start from. */
export const defaultPatternFrom = (today: string): SeriesPattern => defaultPattern(addDays(today, 1));

export function isPatternOk(p: SeriesPattern): boolean {
  const endOk = p.count !== null ? p.count >= 1 : p.endDate !== null && p.endDate >= p.firstDate;
  return p.weekdays.length > 0 && p.startTime !== '' && ISO_DATE.test(p.firstDate) && endOk;
}

/** The request body for preview and create: exactly the pattern fields. */
export function patternBody(p: SeriesPattern) {
  return {
    weekdays: p.weekdays,
    startTime: p.startTime,
    slotCount: p.slotCount,
    firstDate: p.firstDate,
    endDate: p.endDate,
    count: p.count,
  };
}

/** Keeps the start time on one the first date offers (the first slot when it no longer does). */
export function useStartTimeSync(
  slotTimes: string[],
  ready: boolean,
  setPattern: (update: (p: SeriesPattern) => SeriesPattern) => void,
) {
  const key = slotTimes.join(',');
  useEffect(() => {
    if (!ready) return;
    setPattern((p) => (slotTimes.includes(p.startTime) || slotTimes.length === 0 ? p : { ...p, startTime: slotTimes[0]! }));
  }, [key, ready]);
}
