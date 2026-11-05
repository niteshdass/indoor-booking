import { useCallback, useEffect, useState } from 'react';
import { addDays, localParts, type SeriesJson } from '@booking/shared';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { awaitsVerification } from '../booking/model';
import { ownerPath } from '../labels';
import { refundsToSendPath, type RefundsPage } from '../refunds/api';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import type { Courts } from './model';

/** Active courts with their slot day; null until loaded or when the load fails (an extra: Today works without it). */
export function useCourts(ownerId: string, venueId: string, date: string | null): { courts: Courts | null; reload(): void } {
  const key = `${ownerId}|${venueId}|${date}`;
  const [tracked, setTracked] = useState<{ key: string; courts: Courts | null }>({ key: '', courts: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (date === null) return;
    let live = true;
    const v = encodeURIComponent(venueId);
    (async () => {
      const { turfs: all } = await apiGet<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${v}/turfs`));
      const turfs = all.filter((x) => x.active);
      const list = await Promise.all(
        turfs.map((x) => apiGet<{ day: OwnerSlotDay }>(ownerPath(ownerId, `/venues/${v}/turfs/${encodeURIComponent(x.id)}/slots?date=${date}`))),
      );
      const days: Record<string, OwnerSlotDay> = {};
      turfs.forEach((x, i) => (days[x.id] = list[i]!.day));
      return { turfs, days };
    })().then(
      (courts) => live && setTracked({ key, courts }),
      () => live && setTracked((cur) => (cur.key === key && cur.courts ? cur : { key, courts: null })),
    );
    return () => {
      live = false;
    };
  }, [key, ownerId, venueId, date, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { courts: tracked.key === key ? tracked.courts : null, reload };
}

/**
 * Everything the Today tab reads for one venue (web TodayVenue + useTodayExtras, without reviews). With `canVerify`
 * it also reads the venue's wallet refunds still to send.
 */
export function useToday(ownerId: string, venue: OwnerVenue, canVerify = false) {
  const v = encodeURIComponent(venue.id);
  const today = localParts(new Date(), venue.timezone).date;
  const lastWeekDate = addDays(today, -7);
  const bookings = useResource<{ bookings: OwnerBooking[] }>(ownerPath(ownerId, `/bookings?venueId=${v}`), { keepOnError: true });
  const toVerify = useResource<{ bookings: OwnerBooking[]; total?: number }>(
    ownerPath(ownerId, `/bookings?venueId=${v}&scope=to_verify&sort=date-asc&page=1&pageSize=1`),
    { keepOnError: true },
  );
  const lastWeek = useResource<{ bookings: OwnerBooking[] }>(ownerPath(ownerId, `/bookings?venueId=${v}&from=${lastWeekDate}&to=${lastWeekDate}`));
  const series = useResource<{ series: SeriesJson[] }>(ownerPath(ownerId, `/series?venueId=${v}&status=requested`));
  const refunds = useResource<RefundsPage>(canVerify ? refundsToSendPath(ownerId, { venueId: venue.id }) : null);
  const courts = useCourts(ownerId, venue.id, today);
  const { reload: reloadBookings } = bookings;
  const { reload: reloadToVerify } = toVerify;
  const { reload: reloadSeries } = series;
  const { reload: reloadCourts } = courts;
  const { reload: reloadRefunds } = refunds;
  const refresh = useCallback(() => {
    reloadBookings();
    reloadToVerify();
    reloadSeries();
    reloadCourts();
    reloadRefunds();
  }, [reloadBookings, reloadToVerify, reloadSeries, reloadCourts, reloadRefunds]);
  return {
    today,
    bookings,
    refresh,
    courts: courts.courts,
    toVerify:
      toVerify.state.status === 'ready'
        ? { total: toVerify.state.data.total ?? 0, first: toVerify.state.data.bookings.find(awaitsVerification) ?? null }
        : null,
    lastWeek: lastWeek.state.status === 'ready' ? lastWeek.state.data.bookings : null,
    requests: series.state.status === 'ready' ? series.state.data.series : null,
    refunds: refunds.state.status === 'ready' ? refunds.state.data : null,
  };
}

/** Bookings and courts for one schedule day; today reuses what Today already loaded. */
export function useScheduleDay(ownerId: string, venue: OwnerVenue, date: string, today: string) {
  const other = date !== today;
  const v = encodeURIComponent(venue.id);
  const bookings = useResource<{ bookings: OwnerBooking[] }>(other ? ownerPath(ownerId, `/bookings?venueId=${v}&from=${date}&to=${date}`) : null, {
    keepOnError: true,
  });
  const courts = useCourts(ownerId, venue.id, other ? date : null);
  return { bookings, courts: courts.courts, reloadCourts: courts.reload };
}
