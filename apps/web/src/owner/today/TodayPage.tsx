import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BookingStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PendingActions } from '../bookings/BookingActions';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { Paged } from '../../components/ui/Pagination';
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
  const { t, i18n } = useTranslation();
  const { can } = useOwner();
  const [venue] = useVenueParam();
  useOwnerTitle(t('owner.nav.today'));

  if (!venue) {
    return (
      <div className={styles.page}>
        <EmptyState title={t('owner.today.noVenues')} />
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
      <div className={styles.toolbar}>
        <p className={styles.date}>
          {new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: venue.timezone }).format(
            new Date(),
          )}
        </p>
        <VenueSelect />
        {can('reports.view') && (
          <Link to={`overview?venue=${encodeURIComponent(venue.id)}`} className={styles.trends}>
            {t('owner.today.trends')}
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
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
  if (state.status !== 'ready') return <Skeleton kind="dashboard" label={t('common.loading')} />;

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
        <StatCard
          label={t('owner.today.pending')}
          value={String(pending)}
          tone={pending > 0 ? 'warning' : undefined}
          hint={pending === 0 ? t('owner.today.caughtUp') : undefined}
        />
      </div>
      <CourtTimeline bookings={bookings} timezone={venue.timezone} courts={extras.courts} />
      <div className={styles.split}>
        <Attention venue={venue} bookings={bookings} requests={extras.requests} lowReviews={extras.lowReviews} />
        <section className={styles.panel} aria-labelledby="today-upcoming">
          <div className={styles.panelHead}>
            <h2 id="today-upcoming" className={styles.heading}>
              {t('owner.today.upcoming')}
            </h2>
            {upcoming.length > 0 && <span className={styles.count}>{upcoming.length}</span>}
          </div>
          {upcoming.length === 0 ? (
            <p className={styles.empty}>{t('owner.today.none')}</p>
          ) : (
            <Paged items={upcoming} pageSize={10}>
              {(rows) => (
                <Table bare caption={t('owner.today.upcoming')}>
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
                    {rows.map((b) => {
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
            </Paged>
          )}
        </section>
      </div>
    </>
  );
}
