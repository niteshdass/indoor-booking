import { WEEKDAYS, type Weekday } from '@booking/shared';

/** Short weekday name in the UI language; index 0 is Monday. */
export function weekdayName(lang: string, index: number): string {
  // 2024-01-01 is a Monday; index walks Mon..Sun.
  return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index)));
}

/** "Mon, Wed" for a set of pattern weekdays, in week order. */
export function weekdayList(days: Weekday[], lang: string): string {
  return WEEKDAYS.map((d, i) => (days.includes(d) ? weekdayName(lang, i) : null))
    .filter((x): x is string => x !== null)
    .join(', ');
}
