import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookingStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PendingActions } from '../bookings/BookingActions';
import { Spinner } from '../../components/ui/Spinner';
import { StatCard } from '../../components/ui/StatCard';
import { Table } from '../../components/ui/Table';
import { errorMessage } from '../../lib/errors';
import { formatTime, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerBooking, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { summarize } from './summarize';
import { Attention } from './Attention';
import { CourtTimeline, courtUsage } from './CourtTimeline';
import { useTodayExtras } from './useTodayExtras';
import styles from './TodayPage.module.css';

/** Owner landing page: today's totals for one venue and the queue of bookings still to come. */
export function TodayPage() {
  const { t } = useTranslation();
  const { can } = useOwner();
  const [venue] = useVenueParam();
  useOwnerTitle(t('owner.nav.today'));

  if (!venue) {
    return (
      <div className={styles.page}>
        <p className={styles.empty}>{t('owner.today.noVenues')}</p>
        {can('venue.manage') && (
          <Link to="venues/new" className={styles.cta}>
            {t('owner.today.createVenue')}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <VenueSelect />
      <TodayVenue venue={venue} />
    </div>
  );
}

function TodayVenue({ venue }: { venue: OwnerVenue }) {
  const { t, i18n } = useTranslation();
  const { ownerId, can } = useOwner();
  const canConfirm = can('booking.confirm');
  const lang = i18n.language;
  const { state, reload } = useResource<{ bookings: OwnerBooking[] }>(
    ownerPath(ownerId, `/bookings?venueId=${encodeURIComponent(venue.id)}`),
  );
  const extras = useTodayExtras(venue);

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.empty}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Spinner label={t('common.loading')} />;

  const { bookings } = state.data;
  const { count, collected, pending, upcoming } = summarize(bookings);
  const usage = courtUsage(bookings, extras.courts, venue.timezone);
  const hoursFmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  return (
    <>
      <div className={styles.stats}>
        <StatCard
          label={t('owner.today.bookings')}
          value={String(count)}
          hint={extras.lastWeek ? t('owner.today.lastWeek', { n: summarize(extras.lastWeek).count }) : undefined}
        />
        <StatCard
          label={t('owner.today.collected')}
          value={money(collected, venue.currency, lang)}
          hint={t('owner.today.collectedHint')}
        />
        {usage && (
          <StatCard
            label={t('owner.today.courtsUsed')}
            value={new Intl.NumberFormat(lang, { style: 'percent' }).format(usage.booked / usage.open)}
            meter={usage.booked / usage.open}
            hint={t('owner.today.courtsUsedHint', { booked: hoursFmt.format(usage.booked), open: hoursFmt.format(usage.open) })}
          />
        )}
        <StatCard label={t('owner.today.pending')} value={String(pending)} tone={pending > 0 ? 'warning' : undefined} />
      </div>
      <CourtTimeline bookings={bookings} timezone={venue.timezone} courts={extras.courts} />
      <Attention venue={venue} bookings={bookings} requests={extras.requests} lowReviews={extras.lowReviews} />
      <h2 className={styles.heading}>{t('owner.today.upcoming')}</h2>
      {upcoming.length === 0 ? (
        <p className={styles.empty}>{t('owner.today.none')}</p>
      ) : (
        <Table caption={t('owner.today.upcoming')}>
          <thead>
            <tr>
              <th>{t('owner.today.time')}</th>
              <th>{t('owner.today.turf')}</th>
              <th>{t('owner.today.customer')}</th>
              <th>{t('owner.today.status')}</th>
              {canConfirm && <th>{t('owner.bookings.actions.title')}</th>}
            </tr>
          </thead>
          <tbody>
            {upcoming.map((b) => {
              const starts = b.slots.map((s) => s.startAt).sort();
              const ends = b.slots.map((s) => s.endAt).sort();
              return (
                <tr key={b.id}>
                  <td className={styles.time}>
                    {formatTime(starts[0]!, venue.timezone, lang)} – {formatTime(ends[ends.length - 1]!, venue.timezone, lang)}
                  </td>
                  <td>{b.turf?.name ?? '—'}</td>
                  <td>
                    <Link to={`bookings/${encodeURIComponent(b.id)}`} className={styles.link}>
                      {b.customer?.name ?? b.reference}
                    </Link>
                  </td>
                  <td>
                    <BookingStatusBadge status={b.status} />
                  </td>
                  {canConfirm && <td>{b.status === 'pending' && <PendingActions id={b.id} onDone={reload} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
