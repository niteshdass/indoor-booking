import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BOOKING_STATUSES } from '@booking/shared';
import { BookingStatusBadge, PaymentStatusBadge } from '../../bookings/BookingStatusBadge';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PAGE_SIZE, Pagination } from '../../components/ui/Pagination';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { SeriesBadge } from '../../series/SeriesBadge';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import type { OwnerBooking, OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import {
  apiPathFor,
  BOOKING_SORTS,
  BOOKING_TABS,
  DEFAULT_SORT,
  filtersToParams,
  rangeError,
  readFilters,
  type BookingFilters,
} from './bookingFilters';
import { awaitsVerification } from './availableActions';
import styles from './BookingsPage.module.css';

const SEARCH_DEBOUNCE_MS = 250;

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Every booking of one venue under All / Today / Upcoming / Past tabs, filtered, sorted and paged through the URL. */
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
  const requested = readFilters(params, venue.id);

  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  // A turf only counts once the venue's turf list has loaded and contains it; otherwise it is dropped.
  const known = turfs.state.status === 'ready' && turfs.state.data.turfs.some((x) => x.id === requested.turfId);
  const filters: BookingFilters = { ...requested, turfId: known ? requested.turfId : null };
  const waitingForTurfs = requested.turfId !== null && turfs.state.status !== 'ready' && turfs.state.status !== 'error';
  const error = rangeError(filters);

  /** Writes the filters back to the URL, keeping the venue. */
  const update = (patch: Partial<BookingFilters>, venueId = venue.id) => {
    const next = filtersToParams({ ...filters, ...patch });
    if (venueId !== venues[0]?.id || params.has('venue')) next.set('venue', venueId);
    setParams(next, { replace: true });
  };

  // Filters inside the panel that narrow the tab (a court, a status, a date range); the trigger shows the count.
  const active = [filters.turfId, filters.status, filters.from || filters.to].filter(Boolean).length;
  const cleared = { turfId: null, status: null, from: null, to: null };
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
  const sortOptions = BOOKING_SORTS.map((s) => ({ value: s, label: t(`owner.bookings.sort.${s}`) }));
  const statusOptions = [
    { value: '', label: t('owner.bookings.allStatuses') },
    ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];

  return (
    <div className={styles.page}>
      <Tabs
        label={t('owner.nav.bookings')}
        tabs={BOOKING_TABS.map((x) => ({ id: x, label: t(`owner.bookings.tab.${x}`) }))}
        value={filters.tab}
        // Each tab opens in its own order: newest booked first for All, soonest first for Today and Upcoming, latest first for Past.
        onChange={(id) => {
          const tab = BOOKING_TABS.find((x) => x === id) ?? 'all';
          update({ tab, sort: DEFAULT_SORT[tab] });
        }}
      />
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
                  value={filters.from ?? ''}
                  onChange={(e) => update({ from: e.target.value || null })}
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
                  value={filters.to ?? ''}
                  onChange={(e) => update({ to: e.target.value || null })}
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
                onClick={() => update(cleared)}
              >
                {t('owner.bookings.clearFilters')}
              </Button>
              <Button size="sm" onClick={closeFilters}>
                {t('owner.bookings.done')}
              </Button>
            </div>
          </div>
        </div>
        <Select
          className={styles.sort}
          size="lg"
          label={t('owner.bookings.sortLabel')}
          value={filters.sort}
          onChange={(e) => update({ sort: BOOKING_SORTS.find((s) => s === e.target.value) ?? DEFAULT_SORT[filters.tab] })}
          options={sortOptions}
        />
      </div>
      {waitingForTurfs ? (
        <Skeleton kind="table" label={t('common.loading')} />
      ) : error ? (
        <Alert tone="danger">{t(error)}</Alert>
      ) : (
        <div role="tabpanel" aria-label={t(`owner.bookings.tab.${filters.tab}`)}>
          <BookingsList venue={venue} filters={filters} onClear={active > 0 || filters.q ? () => update({ q: '', ...cleared }) : undefined} />
        </div>
      )}
    </div>
  );
}

function BookingsList({ venue, filters, onClear }: { venue: OwnerVenue; filters: BookingFilters; onClear?: () => void }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const lang = i18n.language;
  // The server search waits for a pause in typing.
  const q = useDebounced(filters.q, SEARCH_DEBOUNCE_MS);
  // The page lives in the URL, so coming back from a booking returns to it; any filter change drops it.
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setPage = (n: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (n > 1) next.set('page', String(n));
        else next.delete('page');
        return next;
      },
      { replace: true },
    );
  const { state, reload } = useResource<{ bookings: OwnerBooking[]; total: number }>(apiPathFor(ownerId, { ...filters, q }, page));
  // While another page of the same list loads, the current one stays on screen instead of a skeleton.
  const listKey = apiPathFor(ownerId, { ...filters, q }, 1);
  const shown = useRef<{ key: string; data: { bookings: OwnerBooking[]; total: number } } | null>(null);
  if (state.status === 'ready') shown.current = { key: listKey, data: state.data };
  const data = state.status === 'ready' ? state.data : shown.current?.key === listKey ? shown.current.data : null;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const pastEnd = data !== null && state.status === 'ready' && page > pageCount;

  // A page past the end (the list shrank, or an old link) moves to the last page.
  useEffect(() => {
    if (pastEnd) setPage(pageCount);
  }, [pastEnd, pageCount]);

  const range =
    filters.from && filters.to
      ? filters.from === filters.to
        ? formatDate(filters.from, venue.timezone, lang)
        : `${formatDate(filters.from, venue.timezone, lang)} – ${formatDate(filters.to, venue.timezone, lang)}`
      : filters.from
        ? `${formatDate(filters.from, venue.timezone, lang)} –`
        : filters.to
          ? `– ${formatDate(filters.to, venue.timezone, lang)}`
          : null;

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
  if (!data || pastEnd) return <Skeleton kind="table" label={t('common.loading')} />;
  const rows = data.bookings;

  return (
    <div className={styles.results} aria-busy={state.status !== 'ready' || undefined}>
      {data.total > 0 && (
        <p className={styles.count}>
          {t('owner.bookings.count', { count: data.total })}
          {range && ` · ${range}`}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          sport="padel"
          title={t('owner.bookings.empty')}
          description={t(q.trim() ? 'owner.bookings.emptySearchHint' : onClear ? 'owner.bookings.emptyFilteredHint' : 'owner.bookings.emptyHint')}
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
                      <BookingStatusBadge status={b.status} toVerify={awaitsVerification(b)} />
                      <PaymentStatusBadge status={b.paymentStatus} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} loading={state.status !== 'ready'} onPage={setPage} />
    </div>
  );
}
