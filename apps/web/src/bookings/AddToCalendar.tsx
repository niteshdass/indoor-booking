import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { buildIcs, downloadIcs, googleCalendarUrl, runsOf, type CalendarEvent } from '../lib/calendar';
import type { BookingJson } from '../lib/types';
import styles from './BookingDetailPage.module.css';

const LIVE = new Set(['pending', 'confirmed']);

/** A pending or confirmed booking whose game has not ended yet. */
export function onCalendar(b: BookingJson, now = Date.now()): boolean {
  return LIVE.has(b.status) && b.slots.some((s) => Date.parse(s.endAt) > now);
}

type Props = {
  booking: BookingJson;
  /** The other days booked in the same go; the live ones join the file. */
  group: BookingJson[];
};

/** "Add to calendar" (an .ics of this booking and its live group) with a Google Calendar link under it. */
export function AddToCalendar({ booking, group }: Props) {
  const { t } = useTranslation();
  const origin = window.location.origin;
  const eventsOf = (b: BookingJson): CalendarEvent[] =>
    runsOf(b.slots).map((run, i) => ({
      uid: `${b.id}-${i}@bookaturf`,
      startAt: run.startAt,
      endAt: run.endAt,
      title: b.turf && b.venue ? t('calendar.title', { turf: b.turf.name, venue: b.venue.name }) : (b.venue?.name ?? t('app.name')),
      location: b.venue ? `${b.venue.address}, ${b.venue.city}` : '',
      description: t('calendar.details', { reference: b.reference }),
      url: `${origin}/me/bookings/${encodeURIComponent(b.id)}`,
    }));
  const all = [booking, ...group.filter((b) => onCalendar(b))]
    .sort((a, b) => Date.parse(a.slots[0]?.startAt ?? '') - Date.parse(b.slots[0]?.startAt ?? ''))
    .flatMap(eventsOf);
  const own = eventsOf(booking)[0];
  if (!own) return null;
  const save = () => downloadIcs(buildIcs(all, new Date(), t('calendar.reminder')), `Booking-${booking.reference}.ics`);
  return (
    <div className={styles.move}>
      <Button variant="secondary" size="lg" icon="calendarCheck" block onClick={save}>
        {t('calendar.add')}
      </Button>
      <p className={styles.moveHint}>
        <a className={styles.hintLink} href={googleCalendarUrl(own)} target="_blank" rel="noopener noreferrer">
          {t('calendar.google')}
        </a>
      </p>
    </div>
  );
}
