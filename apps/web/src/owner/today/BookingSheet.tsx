import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Badge } from '../../components/ui/Badge';
import { Sheet } from '../../components/ui/Sheet';
import { formatTime, money } from '../../lib/format';
import { BookingActions } from '../bookings/BookingActions';
import { customerLabel } from '../customerLabel';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { BookingDetail, OwnerBooking, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import styles from './BookingSheet.module.css';

const PAYMENT_TONE = { succeeded: 'success', pending: 'warning', failed: 'danger' } as const;

/**
 * One booking from Today in a sheet: who, when, money and payments, and the actions this member has. Open while
 * `booking` is set; the page passes its current list copy, so a refresh updates the sheet in place.
 */
export function BookingSheet({
  booking,
  venue,
  onClose,
  onChanged,
}: {
  booking: OwnerBooking | null;
  venue: OwnerVenue;
  onClose(): void;
  /** An action changed the booking: Today reloads its list. */
  onChanged(): void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={booking !== null} onClose={onClose} title={t('owner.today.sheet.title')}>
      {booking && <SheetBody key={booking.id} booking={booking} venue={venue} onChanged={onChanged} />}
    </Sheet>
  );
}

function SheetBody({ booking, venue, onChanged }: { booking: OwnerBooking; venue: OwnerVenue; onChanged(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId } = useOwner();
  const id = encodeURIComponent(booking.id);
  const detail = useResource<BookingDetail>(ownerPath(ownerId, `/bookings/${id}`), { keepOnError: true });
  const data = detail.state.status === 'ready' ? detail.state.data : null;

  // Whichever copy arrived last wins: the list's (a refresh), the detail's (a reload) or an action's result.
  const [shown, setShown] = useState(booking);
  useEffect(() => setShown(booking), [booking]);
  useEffect(() => {
    if (data) setShown(data.booking);
  }, [data]);

  const changed = (b: OwnerBooking) => {
    setShown(b);
    detail.reload();
    onChanged();
  };

  const b = shown;
  const tz = venue.timezone;
  const due = Math.max(0, b.total - b.amountPaid);
  const ends = b.slots.map((s) => s.endAt).sort();
  const starts = b.slots.map((s) => s.startAt).sort();
  const payments = data?.payments ?? [];

  return (
    <div className={styles.body}>
      <div className={styles.who}>
        <p className={styles.name}>{customerLabel(b, t)}</p>
        <div className={styles.badges}>
          <BookingStatusBadge status={b.status} />
          <PaymentStatusBadge status={b.paymentStatus} />
        </div>
        {b.customer?.phone && (
          <a href={`tel:${b.customer.phone}`} className={styles.link} aria-label={t('owner.today.sheet.call', { phone: b.customer.phone })}>
            {b.customer.phone}
          </a>
        )}
        {starts.length > 0 && (
          <p className={styles.when}>
            {b.turf?.name ?? '—'} · {formatTime(starts[0]!, tz, lang)}–{formatTime(ends[ends.length - 1]!, tz, lang)}
          </p>
        )}
      </div>

      <dl className={styles.amounts}>
        <div>
          <dt>{t('owner.bookings.total')}</dt>
          <dd>{money(b.total, b.currency, lang)}</dd>
        </div>
        <div>
          <dt>{t('owner.bookings.paid')}</dt>
          <dd>{money(b.amountPaid, b.currency, lang)}</dd>
        </div>
        {due > 0 && (
          <div className={styles.due}>
            <dt>{t('owner.today.sheet.due')}</dt>
            <dd>{money(due, b.currency, lang)}</dd>
          </div>
        )}
      </dl>

      {payments.length > 0 && (
        <section aria-labelledby="sheet-payments">
          <h3 id="sheet-payments" className={styles.subhead}>
            {t('owner.bookings.payments')}
          </h3>
          <ul className={styles.payments}>
            {payments.map((p) => (
              <li key={p.id} className={styles.payment}>
                <span>{t(`cancel.method.${p.method}`)}</span>
                <span className={styles.num}>{money(p.amount, p.currency, lang)}</span>
                <Badge tone={PAYMENT_TONE[p.status]}>{t(`owner.bookings.payStatus.${p.status}`)}</Badge>
                <span className={styles.muted}>{formatTime(p.createdAt, tz, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BookingActions
        booking={b}
        size="lg"
        block
        onUpdated={changed}
        onPaid={changed}
        onCancelled={changed}
        onConflict={detail.reload}
      />

      <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings/${id}`} className={styles.link}>
        {t('owner.today.sheet.openBooking')}
      </Link>
    </div>
  );
}
