/** One calendar entry: a run of back-to-back slots. Times are ISO instants. */
export type CalendarEvent = {
  uid: string;
  startAt: string;
  endAt: string;
  title: string;
  location: string;
  description: string;
  url?: string;
};

type Timed = { startAt: string; endAt: string };

/** Slots merged into back-to-back runs, earliest first. */
export function runsOf<T extends Timed>(slots: readonly T[]): Timed[] {
  const sorted = [...slots].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const out: Timed[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && Date.parse(last.endAt) === Date.parse(s.startAt)) last.endAt = s.endAt;
    else out.push({ startAt: s.startAt, endAt: s.endAt });
  }
  return out;
}

/** 20261103T120000Z */
const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 TEXT escaping. */
const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a UTF-8 character (Bangla and Cyrillic names). */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    // Continuation lines start with a space, which counts toward their 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** An iCalendar file (CRLF lines) with one VEVENT per event and a reminder an hour before each. */
export function buildIcs(events: readonly CalendarEvent[], now: Date, reminder: string): string {
  const stamp = utcStamp(now.toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BookaTurf//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(e.startAt)}`,
      `DTEND:${utcStamp(e.endAt)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `LOCATION:${escapeText(e.location)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(reminder)}`,
      'TRIGGER:-PT1H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Google Calendar's "add event" page prefilled with one event. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${utcStamp(e.startAt)}/${utcStamp(e.endAt)}`,
    details: e.url ? `${e.description}\n${e.url}` : e.description,
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Saves `ics` as `fileName`; phones hand a text/calendar download to the calendar app. */
export function downloadIcs(ics: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
