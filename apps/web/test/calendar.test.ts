import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl, runsOf, type CalendarEvent } from '../src/lib/calendar';

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: 'b1-0@bookaturf',
  startAt: '2026-11-03T12:00:00.000Z',
  endAt: '2026-11-03T14:00:00.000Z',
  title: 'Turf A · Arena One',
  location: 'Road 1, Dhaka',
  description: 'Booking AB12CD.',
  url: 'https://bookaturf.test/me/bookings/b1',
  ...over,
});

const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('runsOf', () => {
  it('merges back-to-back slots and keeps gaps apart, earliest first', () => {
    expect(
      runsOf([
        { startAt: '2026-11-03T15:00:00.000Z', endAt: '2026-11-03T16:00:00.000Z' },
        { startAt: '2026-11-03T13:00:00.000Z', endAt: '2026-11-03T14:00:00.000Z' },
        { startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T13:00:00.000Z' },
      ]),
    ).toEqual([
      { startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T14:00:00.000Z' },
      { startAt: '2026-11-03T15:00:00.000Z', endAt: '2026-11-03T16:00:00.000Z' },
    ]);
  });
});

describe('buildIcs', () => {
  const now = new Date('2026-11-02T08:30:00.000Z');

  it('writes one VEVENT with UTC times, a reminder an hour before, and CRLF lines', () => {
    const ics = buildIcs([event()], now, 'Starts in an hour');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    const lines = unfold(ics).split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTAMP:20261102T083000Z');
    expect(lines).toContain('DTSTART:20261103T120000Z');
    expect(lines).toContain('DTEND:20261103T140000Z');
    expect(lines).toContain('UID:b1-0@bookaturf');
    expect(lines).toContain('TRIGGER:-PT1H');
    expect(lines).toContain('DESCRIPTION:Starts in an hour');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('escapes commas, semicolons, backslashes and newlines', () => {
    const ics = unfold(buildIcs([event({ location: 'Road 1, Dhaka; gate\\B', description: 'a\nb' })], now, 'r'));
    expect(ics).toContain('LOCATION:Road 1\\, Dhaka\\; gate\\\\B');
    expect(ics).toContain('DESCRIPTION:a\\nb');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const title = 'ফুটবল মাঠ · ঢাকা এরিনা '.repeat(6);
    const ics = buildIcs([event({ title })], now, 'r');
    const bytes = new TextEncoder();
    for (const line of ics.split('\r\n')) expect(bytes.encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('�');
    expect(unfold(ics)).toContain(`SUMMARY:${title}`);
  });
});

describe('googleCalendarUrl', () => {
  it('prefills title, dates, place and details with the link', () => {
    const url = new URL(googleCalendarUrl(event()));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Turf A · Arena One');
    expect(url.searchParams.get('dates')).toBe('20261103T120000Z/20261103T140000Z');
    expect(url.searchParams.get('location')).toBe('Road 1, Dhaka');
    expect(url.searchParams.get('details')).toBe('Booking AB12CD.\nhttps://bookaturf.test/me/bookings/b1');
  });
});
