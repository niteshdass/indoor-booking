import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { amountDue, BOOKING_STATUSES } from '@booking/shared';
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
import { ExportCsvButton } from '../export/ExportCsv';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
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
  type BookingTab,
} from './bookingFilters';
import { RowActions } from './BookingActions';
import { availableActions, awaitsVerification } from './availableActions';
import styles from './BookingsPage.module.css';

const SEARCH_DEBOUNCE_MS = 250;

/** One page of the list; the Dues tab adds what every matching booking still owes, per currency. */
type ListPage = { bookings: OwnerBooking[]; total: number; due?: { currency: string; amount: number }[] };

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Bookings of every venue (or the one in `?venue=`) under All / Today / Upcoming / Past / Dues tabs, filtered, sorted and paged through the URL. */
export function BookingsPage() {
  const { t } = useTranslation();
  const { venues } = useOwner();
  useOwnerTitle(t('owner.nav.bookings'));
  if (venues.length === 0) return <EmptyState title={t('owner.today.noVenues')} />;
  return <BookingsVenue />;
}

function BookingsVenue() {
  const { t } = useTranslation();
  const { ownerId, venues } = useOwner();
  const [params, setParams] = useSearchParams();
  const id = useId();
  // No venue (or an unknown one) lists every venue.
  const venue = venues.find((v) => v.id === params.get('venue')) ?? null;
  const requested = readFilters(params, venue?.id ?? null);
  // Courts belong to one venue: the chosen one, or the only one.
  const turfVenue = venue ?? (venues.length === 1 ? venues[0]! : null);

  const turfs = useResource<{ turfs: OwnerTurf[] }>(turfVenue ? ownerPath(ownerId, `/venues/${encodeURIComponent(turfVenue.id)}/turfs`) : null);
  // A turf only counts once the venue's turf list has loaded and contains it; otherwise it is dropped.
  const known = turfs.state.status === 'ready' && turfs.state.data.turfs.some((x) => x.id === requested.turfId);
  const filters: BookingFilters = { ...requested, turfId: known ? requested.turfId : null };
  const waitingForTurfs = turfVenue !== null && requested.turfId !== null && turfs.state.status !== 'ready' && turfs.state.status !== 'error';
  const error = rangeError(filters);

  /** Writes the filters back to the URL, keeping the venue unless the patch names one. */
  const update = (patch: Partial<BookingFilters>) => {
    const next = filtersToParams({ ...filters, ...patch });
    const venueId = patch.venueId === undefined ? filters.venueId : patch.venueId;
    if (venueId) next.set('venue', venueId);
    setParams(next, { replace: true });
  };

  // Filters inside the panel that narrow the tab (a venue, a court, a status, a date range); the trigger shows the count.
  const active = [filters.venueId, filters.turfId, filters.status, filters.from || filters.to].filter(Boolean).length;
  const cleared = { venueId: null, turfId: null, status: null, from: null, to: null };
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
  const tabLabel = (x: BookingTab) => (x === 'to_verify' ? t('status.paymentToCheck') : t(`owner.bookings.tab.${x}`));
  const sortOptions = BOOKING_SORTS.map((s) => ({ value: s, label: t(`owner.bookings.sort.${s}`) }));
  const statusOptions = [
    { value: '', label: t('owner.bookings.allStatuses') },
    ...BOOKING_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
  ];

  return (
    <div className={styles.page}>
      <Tabs
        label={t('owner.nav.bookings')}
        tabs={BOOKING_TABS.map((x) => ({ id: x, label: tabLabel(x) }))}
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
                icon="venue"
                layout="stacked"
                label={t('owner.venue')}
                value={venue?.id ?? ''}
                // Turfs belong to a venue, so changing venue clears the turf.
                onChange={(e) => update({ venueId: e.target.value || null, turfId: null })}
                options={[{ value: '', label: t('owner.bookings.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
              />
            )}
            {/* Courts are picked within one venue. */}
            {turfVenue && (
              <Select
                icon="court"
                layout="stacked"
                label={t('owner.bookings.turf')}
                value={filters.turfId ?? ''}
                onChange={(e) => update({ turfId: e.target.value || null })}
                options={turfOptions}
              />
            )}
            <Select
              icon="status"
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
                icon="close"
                disabled={active === 0}
                onClick={() => update(cleared)}
              >
                {t('owner.bookings.clearFilters')}
              </Button>
              <Button size="sm" icon="check" onClick={closeFilters}>
                {t('owner.bookings.done')}
              </Button>
            </div>
          </div>
        </div>
        <Select
          className={styles.sort}
          size="lg"
          icon="sort"
          label={t('owner.bookings.sortLabel')}
          value={filters.sort}
          onChange={(e) => update({ sort: BOOKING_SORTS.find((s) => s === e.target.value) ?? DEFAULT_SORT[filters.tab] })}
          options={sortOptions}
        />
        <ExportCsvButton size="lg" venueId={venue?.id ?? null} kind="bookings" from={filters.from} to={filters.to} />
      </div>
      {waitingForTurfs ? (
        <Skeleton kind="table" label={t('common.loading')} />
      ) : error ? (
        <Alert tone="danger">{t(error)}</Alert>
      ) : (
        <div role="tabpanel" aria-label={tabLabel(filters.tab)}>
          <BookingsList filters={filters} onClear={active > 0 || filters.q ? () => update({ q: '', ...cleared }) : undefined} />
        </div>
      )}
    </div>
  );
}

function BookingsList({ filters, onClear }: { filters: BookingFilters; onClear?: () => void }) {
  const { t, i18n } = useTranslation();
  const { ownerId, can, venues } = useOwner();
  const lang = i18n.language;
  // Each row is shown in its own venue's time zone; the range filter is plain dates, any venue's zone reads them the same.
  const venueOf = (b: OwnerBooking): OwnerVenue | undefined => venues.find((v) => v.id === b.venueId);
  const home = (venues.find((v) => v.id === filters.venueId) ?? venues[0])!;
  const zone = home.timezone;
  // Across venues each row names its venue under the court.
  const showVenue = !filters.venueId && venues.length > 1;
  const dues = filters.tab === 'dues';
  // Dues rows carry their own Record cash button, so staff settle a debt without opening the booking.
  const canCollect = dues && can('payment.mark_cash');
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
  const { state, reload } = useResource<ListPage>(apiPathFor(ownerId, { ...filters, q }, page));
  // While another page of the same list loads, the current one stays on screen instead of a skeleton.
  const listKey = apiPathFor(ownerId, { ...filters, q }, 1);
  const shown = useRef<{ key: string; data: ListPage } | null>(null);
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
        ? formatDate(filters.from, zone, lang)
        : `${formatDate(filters.from, zone, lang)} – ${formatDate(filters.to, zone, lang)}`
      : filters.from
        ? `${formatDate(filters.from, zone, lang)} –`
        : filters.to
          ? `– ${formatDate(filters.to, zone, lang)}`
          : null;

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.empty}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" icon="refresh" onClick={reload}>
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
          {data.due !== undefined && (
            <>
              {' · '}
              <span className={styles.dueTotal}>
                {t('owner.bookings.dueTotal', {
                  amount: data.due.length ? data.due.map((d) => money(d.amount, d.currency, lang)).join(' + ') : money(0, home.currency, lang),
                })}
              </span>
            </>
          )}
          {range && ` · ${range}`}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          sport="padel"
          title={t(dues && !q.trim() && !onClear ? 'owner.bookings.duesEmpty' : 'owner.bookings.empty')}
          description={t(
            q.trim()
              ? 'owner.bookings.emptySearchHint'
              : onClear
                ? 'owner.bookings.emptyFilteredHint'
                : dues
                  ? 'owner.bookings.duesEmptyHint'
                  : 'owner.bookings.emptyHint',
          )}
          action={
            onClear && (
              <Button variant="secondary" icon="close" onClick={onClear}>
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
              <th className={styles.num}>{t(dues ? 'owner.bookings.due' : 'owner.bookings.paid')}</th>
              <th>{t('owner.bookings.status')}</th>
              {canCollect && <th>{t('owner.bookings.actions.title')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const tz = venueOf(b)?.timezone ?? zone;
              const starts = b.slots.map((s) => s.startAt).sort();
              const ends = b.slots.map((s) => s.endAt).sort();
              return (
                <tr key={b.id}>
                  <td className={styles.ref}>
                    <Link to={encodeURIComponent(b.id)} className={styles.link} data-row-link>
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
                    {formatDate(b.businessDate, tz, lang)}
                    {starts[0] && ends[ends.length - 1] && (
                      <span className={styles.time}>
                        {formatTime(starts[0], tz, lang)} – {formatTime(ends[ends.length - 1]!, tz, lang)}
                      </span>
                    )}
                  </td>
                  <td className={styles.turf}>
                    {b.turf?.name ?? '—'}
                    {showVenue && <span className={styles.time}>{venueOf(b)?.name}</span>}
                  </td>
                  <td className={styles.customer}>{b.customer?.name ?? b.guest?.name ?? '—'}</td>
                  <td className={`${styles.num} ${styles.total}`} data-label={t('owner.bookings.total')}>{money(b.total, b.currency, lang)}</td>
                  {dues ? (
                    <td className={`${styles.num} ${styles.paid} ${styles.due}`} data-label={t('owner.bookings.due')}>
                      {money(amountDue(b), b.currency, lang)}
                      {b.amountPaid > 0 && (
                        <span className={styles.time}>{t('owner.bookings.paidSoFar', { amount: money(b.amountPaid, b.currency, lang) })}</span>
                      )}
                    </td>
                  ) : (
                    <td
                      className={[styles.num, styles.paid, b.paymentStatus === 'unpaid' && styles.zero].filter(Boolean).join(' ')}
                      data-label={t('owner.bookings.paid')}
                    >
                      {money(b.amountPaid, b.currency, lang)}
                    </td>
                  )}
                  {/* Booking status and payment status side by side, so a row stays two lines tall */}
                  <td className={styles.status}>
                    <span className={styles.badges}>
                      <BookingStatusBadge status={b.status} toVerify={awaitsVerification(b)} />
                      {!awaitsVerification(b) && <PaymentStatusBadge status={b.paymentStatus} />}
                    </span>
                  </td>
                  {canCollect && (
                    <td className={styles.actions}>
                      <RowActions booking={b} primary={availableActions(b, can).includes('markCash') ? 'markCash' : null} onDone={reload} quiet />
                    </td>
                  )}
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
