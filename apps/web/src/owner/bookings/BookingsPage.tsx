import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BOOKING_STATUSES } from '@booking/shared';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { TextField } from '../../components/ui/TextField';
import { SeriesBadge } from '../../series/SeriesBadge';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import type { OwnerBooking, OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { apiPathFor, BOOKINGS_CAP, filtersToParams, matchesQuery, rangeError, readFilters, type BookingFilters } from './bookingFilters';
import styles from './BookingsPage.module.css';

/** All bookings of one venue over a date range, filtered through the URL. */
export function BookingsPage() {
  const { t } = useTranslation();
  const [venue] = useVenueParam();
  useOwnerTitle(t('owner.nav.bookings'));
  if (!venue) return <p className={styles.empty}>{t('owner.today.noVenues')}</p>;
  return <BookingsVenue venue={venue} />;
}

function BookingsVenue({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId, venues } = useOwner();
  const [params, setParams] = useSearchParams();
  const requested = readFilters(params, venue);
  const today = readFilters(new URLSearchParams(), venue).from;

  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  // A turf only counts once the venue's turf list has loaded and contains it; otherwise it is dropped.
  const known = turfs.state.status === 'ready' && turfs.state.data.turfs.some((x) => x.id === requested.turfId);
  const filters: BookingFilters = { ...requested, turfId: known ? requested.turfId : null };
  const waitingForTurfs = requested.turfId !== null && turfs.state.status !== 'ready' && turfs.state.status !== 'error';
  const error = rangeError(filters);

  /** Writes the filters back to the URL, keeping the venue. */
  const update = (patch: Partial<BookingFilters>, venueId = venue.id) => {
    const next = filtersToParams({ ...filters, ...patch }, today);
    if (venueId !== venues[0]?.id || params.has('venue')) next.set('venue', venueId);
    setParams(next, { replace: true });
  };

  const turfOptions = [
    { value: '', label: t('owner.bookings.allTurfs') },
    ...(turfs.state.status === 'ready' ? turfs.state.data.turfs.map((x) => ({ value: x.id, label: x.name })) : []),
  ];
  const statusOptions = [
    { value: '', label: t('owner.bookings.allStatuses') },
    ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];

  return (
    <div className={styles.page}>
      <div className={styles.filters}>
        {venues.length > 1 && (
          <Select
            label={t('owner.venue')}
            value={venue.id}
            // Turfs belong to a venue, so changing venue clears the turf.
            onChange={(e) => update({ turfId: null }, e.target.value)}
            options={venues.map((v) => ({ value: v.id, label: v.name }))}
          />
        )}
        <Select
          label={t('owner.bookings.turf')}
          value={filters.turfId ?? ''}
          onChange={(e) => update({ turfId: e.target.value || null })}
          options={turfOptions}
        />
        <TextField
          type="date"
          label={t('owner.bookings.from')}
          value={filters.from}
          onChange={(e) => e.target.value && update({ from: e.target.value })}
        />
        <TextField
          type="date"
          label={t('owner.bookings.to')}
          value={filters.to}
          onChange={(e) => e.target.value && update({ to: e.target.value })}
        />
        <Select
          label={t('owner.bookings.status')}
          value={filters.status ?? ''}
          onChange={(e) => update({ status: BOOKING_STATUSES.find((s) => s === e.target.value) ?? null })}
          options={statusOptions}
        />
        <TextField
          type="search"
          label={t('owner.bookings.search')}
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
        />
      </div>
      {waitingForTurfs ? (
        <Skeleton kind="table" label={t('common.loading')} />
      ) : error ? (
        <Alert tone="danger">{t(error)}</Alert>
      ) : (
        <BookingsList venue={venue} filters={filters} />
      )}
    </div>
  );
}

function BookingsList({ venue, filters }: { venue: OwnerVenue; filters: BookingFilters }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const lang = i18n.language;
  const { state, reload } = useResource<{ bookings: OwnerBooking[] }>(apiPathFor(ownerId, filters));
  const data = state.status === 'ready' ? state.data.bookings : null;
  const rows = useMemo(() => data?.filter((b) => matchesQuery(b, filters.q)) ?? [], [data, filters.q]);

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
  if (!data) return <Skeleton kind="table" label={t('common.loading')} />;

  return (
    <>
      {data.length >= BOOKINGS_CAP && <Alert tone="warning">{t('owner.bookings.capped')}</Alert>}
      {rows.length === 0 ? (
        <p className={styles.empty}>{t('owner.bookings.empty')}</p>
      ) : (
        <Table caption={t('owner.nav.bookings')}>
          <thead>
            <tr>
              <th>{t('owner.bookings.reference')}</th>
              <th>{t('owner.bookings.when')}</th>
              <th>{t('owner.bookings.turf')}</th>
              <th>{t('owner.bookings.customer')}</th>
              <th>{t('owner.bookings.total')}</th>
              <th>{t('owner.bookings.paid')}</th>
              <th>{t('owner.bookings.status')}</th>
              <th>{t('owner.bookings.source')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const starts = b.slots.map((s) => s.startAt).sort();
              const ends = b.slots.map((s) => s.endAt).sort();
              return (
                <tr key={b.id}>
                  <td>
                    <Link to={encodeURIComponent(b.id)} className={styles.link}>
                      {b.reference}
                    </Link>
                    {b.seriesId && (
                      <span className={styles.time}>
                        <SeriesBadge href={`/owner/${encodeURIComponent(ownerId)}/series/${encodeURIComponent(b.seriesId)}`} />
                      </span>
                    )}
                  </td>
                  <td>
                    {formatDate(b.businessDate, venue.timezone, lang)}
                    {starts[0] && ends[ends.length - 1] && (
                      <span className={styles.time}>
                        {formatTime(starts[0], venue.timezone, lang)} – {formatTime(ends[ends.length - 1]!, venue.timezone, lang)}
                      </span>
                    )}
                  </td>
                  <td>{b.turf?.name ?? '—'}</td>
                  <td>{b.customer?.name ?? b.guest?.name ?? '—'}</td>
                  <td>{money(b.total, venue.currency, lang)}</td>
                  <td>
                    {money(b.amountPaid, venue.currency, lang)}
                    <span className={styles.time}>
                      <PaymentStatusBadge status={b.paymentStatus} />
                    </span>
                  </td>
                  <td>
                    <BookingStatusBadge status={b.status} />
                  </td>
                  <td>{t(b.source === 'walkin' ? 'owner.bookings.sourceWalkin' : 'owner.bookings.sourceOnline')}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
