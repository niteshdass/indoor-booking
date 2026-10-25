import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BOOKING_TONE } from '../../bookings/BookingStatusBadge';
import { formatTime, money } from '../../lib/format';
import { customerLabel } from '../customerLabel';
import type { OwnerBooking, OwnerSlot } from '../types';
import { ROW_MS, type Layout } from './scheduleLayout';
import styles from './ScheduleGrid.module.css';

type Props = {
  layout: Layout;
  timeZone: string;
  currency: string;
  now: number;
  /** Omitted when the member cannot create walk-ins: available slots then render as plain text. */
  onSlot?(turfId: string, slot: OwnerSlot): void;
  bookingHref(id: string): string;
};

/** Turfs as columns, 15-minute rows. The time column and turf headers are placed on the same CSS grid as the cells. */
export function ScheduleGrid({ layout, timeZone, currency, now, onSlot, bookingHref }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { originMs, rows, columns } = layout;
  const endMs = originMs + rows * ROW_MS;
  const showNow = rows > 0 && originMs <= now && now < endMs;
  const time = (ms: number) => formatTime(new Date(ms).toISOString(), timeZone, lang);

  const slotCell = (turfId: string, slot: OwnerSlot) => {
    const label = (
      <>
        <span className={styles.time}>{formatTime(slot.startAt, timeZone, lang)}</span>
        {slot.status === 'available' && slot.price !== null && (
          <span className={styles.price}>{money(slot.price, currency, lang)}</span>
        )}
        {slot.status !== 'available' && <span className={styles.state}>{t(slotStateKey(slot.status))}</span>}
      </>
    );
    const cls = [styles.slot, styles[`slot_${slot.status}`]].join(' ');
    if (slot.status === 'available' && onSlot) {
      return (
        <button type="button" className={cls} onClick={() => onSlot(turfId, slot)}>
          {label}
        </button>
      );
    }
    return <div className={cls}>{label}</div>;
  };

  return (
    <div className={styles.scroll}>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `var(--schedule-time-col) repeat(${columns.length}, minmax(var(--schedule-col-min), 1fr))`,
          gridTemplateRows: `auto repeat(${rows}, var(--schedule-row))`,
        }}
      >
        <div className={styles.corner} style={{ gridRow: 1, gridColumn: 1 }} />
        {columns.map((c, i) => (
          <div key={c.turf.id} className={styles.head} style={{ gridRow: 1, gridColumn: i + 2 }}>
            {c.turf.name}
          </div>
        ))}
        {layout.labels.map((l) => (
          <div key={l.row} className={styles.label} style={{ gridRow: `${l.row + 1} / span 2`, gridColumn: 1 }}>
            {time(l.ms)}
          </div>
        ))}
        {columns.map((c, i) => (
          <div key={`bg-${c.turf.id}`} className={styles.lane} style={{ gridRow: `2 / span ${Math.max(rows, 1)}`, gridColumn: i + 2 }} />
        ))}
        {columns.map((c, i) =>
          c.closed ? (
            <div key={`closed-${c.turf.id}`} className={styles.closed} style={{ gridRow: `2 / span ${Math.max(rows, 1)}`, gridColumn: i + 2 }}>
              <strong>{t('owner.schedule.closed')}</strong>
              {c.closedReason && <span>{c.closedReason}</span>}
            </div>
          ) : (
            c.cells.map((cell) => (
              <div
                key={cell.kind === 'booking' ? `b-${cell.booking.id}` : `s-${cell.slot.startAt}`}
                className={styles.cell}
                style={{ gridRow: `${cell.row + 1} / span ${cell.span}`, gridColumn: i + 2 }}
              >
                {cell.kind === 'booking' ? (
                  <BookingBlock booking={cell.booking} time={time} href={bookingHref(cell.booking.id)} />
                ) : (
                  slotCell(c.turf.id, cell.slot)
                )}
              </div>
            ))
          ),
        )}
        {showNow && (
          <div className={styles.overlay} style={{ gridRow: `2 / span ${rows}`, gridColumn: `2 / span ${columns.length}` }}>
            <div
              data-testid="now-line"
              aria-hidden="true"
              className={styles.now}
              style={{ top: `calc(${(now - originMs) / ROW_MS} * var(--schedule-row))` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function slotStateKey(status: OwnerSlot['status']): string {
  return `slots.${status}`;
}

function BookingBlock({
  booking,
  time,
  href,
}: {
  booking: OwnerBooking;
  time: (ms: number) => string;
  href: string;
}) {
  const { t } = useTranslation();
  const starts = booking.slots.map((s) => Date.parse(s.startAt));
  const ends = booking.slots.map((s) => Date.parse(s.endAt));
  return (
    <Link to={href} className={[styles.booking, styles[`tone_${BOOKING_TONE[booking.status]}`]].join(' ')}>
      <span className={styles.time}>
        {time(Math.min(...starts))} – {time(Math.max(...ends))}
      </span>
      <span className={styles.name}>{customerLabel(booking, t)}</span>
      <span className={styles.state}>{t(`status.${booking.status}`)}</span>
    </Link>
  );
}
