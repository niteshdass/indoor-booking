import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { localParts } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { apiGet } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { DateStrip } from '../../venue/DateStrip';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useVenueParam } from '../shell/useVenueParam';
import { VenueSelect } from '../shell/VenueSelect';
import type { OwnerBooking, OwnerSlot, OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import { ScheduleGrid } from './ScheduleGrid';
import { scheduleLayout } from './scheduleLayout';
import styles from './SchedulePage.module.css';

const REFRESH_MS = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Data = { turfs: OwnerTurf[]; days: Record<string, OwnerSlotDay>; bookings: OwnerBooking[] };
type State = { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; error: unknown };

/** Owner calendar: one venue and date, turfs as columns. */
export function SchedulePage() {
  const { t } = useTranslation();
  const [venue] = useVenueParam();
  useOwnerTitle(t('owner.nav.schedule'));
  if (!venue) return <EmptyState title={t('owner.today.noVenues')} />;
  return (
    <div className={styles.page}>
      <VenueSelect />
      <ScheduleVenue venue={venue} />
    </div>
  );
}

function ScheduleVenue({ venue }: { venue: OwnerVenue }) {
  const { t } = useTranslation();
  const { ownerId, can } = useOwner();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = localParts(new Date(), venue.timezone).date;
  const requested = params.get('date');
  const date = requested && DATE.test(requested) ? requested : today;
  const { state, reload } = useScheduleData(ownerId, venue.id, date);
  const [now, setNow] = useState(() => Date.now());

  // Refetch every minute while the tab is visible; the same tick moves the current-time line.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setNow(Date.now());
      reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  const setDate = useCallback(
    (d: string) =>
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          copy.set('date', d);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );

  const layout = useMemo(
    () => (state.status === 'ready' ? scheduleLayout(state.data.turfs, state.data.days, state.data.bookings) : null),
    [state],
  );

  const canCreate = can('booking.create');
  const onSlot = (turfId: string, slot: OwnerSlot) => {
    const q = new URLSearchParams({ venue: venue.id, turf: turfId, date, start: slot.startAt });
    navigate(`/owner/${encodeURIComponent(ownerId)}/walk-in?${q.toString()}`);
  };

  let body;
  if (state.status === 'error') {
    body = (
      <Alert tone="danger">
        <p className={styles.empty}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  } else if (state.status === 'loading' || !layout) {
    body = <Skeleton kind="detail" label={t('common.loading')} />;
  } else if (state.data.turfs.length === 0) {
    body = <EmptyState sport="futsal" title={t('owner.schedule.noTurfs')} />;
  } else {
    body = (
      <>
        {layout.rows === 0 && <p className={styles.empty}>{t('owner.schedule.noSlots')}</p>}
        <ScheduleGrid
          layout={layout}
          timeZone={venue.timezone}
          currency={venue.currency}
          now={now}
          onSlot={canCreate ? onSlot : undefined}
          bookingHref={(id) => `/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(id)}`}
        />
      </>
    );
  }

  return (
    <>
      <DateStrip today={today} value={date} onChange={setDate} timeZone={venue.timezone} />
      {body}
    </>
  );
}

/** Active turfs, each one's slot day and the date's bookings. A refetch keeps the previous data until the new arrives. */
function useScheduleData(ownerId: string, venueId: string, date: string): { state: State; reload(): void } {
  const [tracked, setTracked] = useState<{ key: string; state: State }>({ key: '', state: { status: 'loading' } });
  const [nonce, setNonce] = useState(0);
  const key = `${ownerId}|${venueId}|${date}`;

  useEffect(() => {
    let live = true;
    const v = encodeURIComponent(venueId);
    (async () => {
      const { turfs: all } = await apiGet<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${v}/turfs`));
      const turfs = all.filter((x) => x.active);
      const [dayList, { bookings }] = await Promise.all([
        Promise.all(
          turfs.map((x) =>
            apiGet<{ day: OwnerSlotDay }>(ownerPath(ownerId, `/venues/${v}/turfs/${encodeURIComponent(x.id)}/slots?date=${date}`)),
          ),
        ),
        apiGet<{ bookings: OwnerBooking[] }>(ownerPath(ownerId, `/bookings?venueId=${v}&from=${date}&to=${date}`)),
      ]);
      const days: Record<string, OwnerSlotDay> = {};
      turfs.forEach((x, i) => (days[x.id] = dayList[i]!.day));
      return { turfs, days, bookings };
    })().then(
      (data) => live && setTracked({ key, state: { status: 'ready', data } }),
      (error: unknown) =>
        live &&
        // A failed background refresh keeps the schedule on screen.
        setTracked((prev) => (prev.key === key && prev.state.status === 'ready' ? prev : { key, state: { status: 'error', error } })),
    );
    return () => {
      live = false;
    };
  }, [key, ownerId, venueId, date, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // A different venue or date never shows the previous one's data.
  const state: State = tracked.key === key ? tracked.state : { status: 'loading' };
  return { state, reload };
}
