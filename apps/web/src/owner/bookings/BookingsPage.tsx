import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BOOKING_STATUSES } from '@booking/shared';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
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
  if (!venue) return <EmptyState title={t('owner.today.noVenues')} />;
  return <BookingsVenue venue={venue} />;
}

function BookingsVenue({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId, venues } = useOwner();
  const [params, setParams] = useSearchParams();
  const id = useId();
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

  // Filters away from the default view (today, every turf and status); the trigger shows the count.
  const active = [filters.turfId, filters.status, filters.from !== today || filters.to !== today].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    firstField.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (!filterRoot.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [filtersOpen]);

  const closeFilters = () => {
    setFiltersOpen(false);
    filterButton.current?.focus({ preventScroll: true });
  };

  const onFilterKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && filtersOpen) {
      e.preventDefault();
      closeFilters();
    }
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
        <div className={styles.search}>
          <label htmlFor={`${id}-q`} className={styles.srOnly}>
            {t('owner.bookings.search')}
          </label>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />
          </svg>
          <input
            id={`${id}-q`}
            type="search"
            className={styles.searchInput}
            placeholder={t('owner.bookings.search')}
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
          />
        </div>
        <div ref={filterRoot} className={styles.filterRoot} onKeyDown={onFilterKey}>
          <button
            ref={filterButton}
            type="button"
            className={styles.filterButton}
            aria-label={active > 0 ? `${t('owner.bookings.filters')}, ${t('owner.bookings.filtersActive', { count: active })}` : t('owner.bookings.filters')}
            title={t('owner.bookings.filters')}
            aria-expanded={filtersOpen}
            aria-controls={`${id}-panel`}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <svg className={styles.filterIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z" />
            </svg>
            {active > 0 && (
              <span className={styles.filterCount} aria-hidden="true">
                {active}
              </span>
            )}
          </button>
          {/* Kept mounted while closed so the fields keep their place in the tab order once shown again. */}
          <div
            id={`${id}-panel`}
            role="group"
            aria-label={t('owner.bookings.filters')}
            className={styles.panel}
            hidden={!filtersOpen}
          >
            <div className={styles.pair}>
              <div className={styles.field}>
                <label htmlFor={`${id}-from`} className={styles.label}>
                  {t('owner.bookings.from')}
                </label>
                <input
                  ref={firstField}
                  id={`${id}-from`}
                  type="date"
                  className={styles.date}
                  value={filters.from}
                  onChange={(e) => e.target.value && update({ from: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-to`} className={styles.label}>
                  {t('owner.bookings.to')}
                </label>
                <input
                  id={`${id}-to`}
                  type="date"
                  className={styles.date}
                  value={filters.to}
                  onChange={(e) => e.target.value && update({ to: e.target.value })}
                />
              </div>
            </div>
            {venues.length > 1 && (
              <Select
                layout="stacked"
                label={t('owner.venue')}
                value={venue.id}
                // Turfs belong to a venue, so changing venue clears the turf.
                onChange={(e) => update({ turfId: null }, e.target.value)}
                options={venues.map((v) => ({ value: v.id, label: v.name }))}
              />
            )}
            <Select
              layout="stacked"
              label={t('owner.bookings.turf')}
              value={filters.turfId ?? ''}
              onChange={(e) => update({ turfId: e.target.value || null })}
              options={turfOptions}
            />
            <Select
              layout="stacked"
              label={t('owner.bookings.status')}
              value={filters.status ?? ''}
              onChange={(e) => update({ status: BOOKING_STATUSES.find((s) => s === e.target.value) ?? null })}
              options={statusOptions}
            />
            <div className={styles.panelFoot}>
              <Button
                variant="ghost"
                size="sm"
                disabled={active === 0}
                onClick={() => update({ turfId: null, status: null, from: today, to: today })}
              >
                {t('owner.bookings.clearFilters')}
              </Button>
              <Button size="sm" onClick={closeFilters}>
                {t('owner.bookings.done')}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {waitingForTurfs ? (
        <Skeleton kind="table" label={t('common.loading')} />
      ) : error ? (
        <Alert tone="danger">{t(error)}</Alert>
      ) : (
        <BookingsList
          venue={venue}
          filters={filters}
          onClear={active > 0 || filters.q ? () => update({ q: '', turfId: null, status: null, from: today, to: today }) : undefined}
        />
      )}
    </div>
  );
}

function BookingsList({ venue, filters, onClear }: { venue: OwnerVenue; filters: BookingFilters; onClear?: () => void }) {
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
      {rows.length > 0 && <p className={styles.count}>{t('owner.bookings.count', { count: rows.length })}</p>}
      {rows.length === 0 ? (
        <EmptyState
          sport="padel"
          title={t('owner.bookings.empty')}
          description={t(onClear ? 'owner.bookings.emptyFilteredHint' : 'owner.bookings.emptyHint')}
          action={
            onClear && (
              <Button variant="secondary" onClick={onClear}>
                {t('owner.bookings.clearFilters')}
              </Button>
            )
          }
        />
      ) : (
        <Table caption={t('owner.nav.bookings')} className={styles.list}>
          <thead className={styles.head}>
            <tr>
              <th>{t('owner.bookings.reference')}</th>
              <th>{t('owner.bookings.when')}</th>
              <th>{t('owner.bookings.turf')}</th>
              <th>{t('owner.bookings.customer')}</th>
              <th className={styles.num}>{t('owner.bookings.total')}</th>
              <th className={styles.num}>{t('owner.bookings.paid')}</th>
              <th>{t('owner.bookings.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const starts = b.slots.map((s) => s.startAt).sort();
              const ends = b.slots.map((s) => s.endAt).sort();
              return (
                <tr key={b.id}>
                  <td className={styles.ref}>
                    <Link to={encodeURIComponent(b.id)} className={styles.link}>
                      {b.reference}
                    </Link>
                    {b.seriesId && (
                      <span className={styles.series}>
                        <SeriesBadge href={`/owner/${encodeURIComponent(ownerId)}/series/${encodeURIComponent(b.seriesId)}`} />
                      </span>
                    )}
                    <span className={styles.time}>
                      {t(b.source === 'walkin' ? 'owner.bookings.sourceWalkin' : 'owner.bookings.sourceOnline')}
                    </span>
                  </td>
                  <td className={styles.when}>
                    {formatDate(b.businessDate, venue.timezone, lang)}
                    {starts[0] && ends[ends.length - 1] && (
                      <span className={styles.time}>
                        {formatTime(starts[0], venue.timezone, lang)} – {formatTime(ends[ends.length - 1]!, venue.timezone, lang)}
                      </span>
                    )}
                  </td>
                  <td className={styles.turf}>{b.turf?.name ?? '—'}</td>
                  <td className={styles.customer}>{b.customer?.name ?? b.guest?.name ?? '—'}</td>
                  <td className={`${styles.num} ${styles.total}`} data-label={t('owner.bookings.total')}>{money(b.total, venue.currency, lang)}</td>
                  <td
                    className={[styles.num, styles.paid, b.paymentStatus === 'unpaid' && styles.zero].filter(Boolean).join(' ')}
                    data-label={t('owner.bookings.paid')}
                  >
                    {money(b.amountPaid, venue.currency, lang)}
                  </td>
                  {/* Booking status and payment status side by side, so a row stays two lines tall */}
                  <td className={styles.status}>
                    <span className={styles.badges}>
                      <BookingStatusBadge status={b.status} />
                      <PaymentStatusBadge status={b.paymentStatus} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
