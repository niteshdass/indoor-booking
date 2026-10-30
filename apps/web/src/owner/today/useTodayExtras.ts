import { useCallback, useEffect, useState } from 'react';
import { addDays, localParts, type OwnerReviewJson, type SeriesJson } from '@booking/shared';
import { apiGet } from '../../lib/apiClient';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking, OwnerSlotDay, OwnerTurf, OwnerVenue } from '../types';
import { useResource } from '../useResource';
import { awaitsVerification } from '../bookings/availableActions';

export type Courts = { turfs: OwnerTurf[]; days: Record<string, OwnerSlotDay> };

const LOW_STARS = 2;
const REVIEW_SCAN = 20;

/**
 * Active turfs with their slot day; null until loaded or when the load fails. `reload()` re-reads them and keeps the
 * current ones on screen until the new ones arrive.
 */
function useCourts(ownerId: string, venueId: string, date: string): { courts: Courts | null; reload(): void } {
  const key = `${ownerId}|${venueId}|${date}`;
  const [tracked, setTracked] = useState<{ key: string; courts: Courts | null }>({ key: '', courts: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    const v = encodeURIComponent(venueId);
    (async () => {
      const { turfs: all } = await apiGet<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${v}/turfs`));
      const turfs = all.filter((x) => x.active);
      const list = await Promise.all(
        turfs.map((x) =>
          apiGet<{ day: OwnerSlotDay }>(ownerPath(ownerId, `/venues/${v}/turfs/${encodeURIComponent(x.id)}/slots?date=${date}`)),
        ),
      );
      const days: Record<string, OwnerSlotDay> = {};
      turfs.forEach((x, i) => (days[x.id] = list[i]!.day));
      return { turfs, days };
    })().then(
      (courts) => live && setTracked({ key, courts }),
      // The court lanes and usage are extras: without them Today still shows its bookings.
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
 * The optional parts of Today: courts and their slot days, the same weekday last week, open series requests,
 * wallet payments to check on any date and unanswered low reviews. Each part is null while loading or when it fails, so the page can leave it out.
 */
export function useTodayExtras(venue: OwnerVenue) {
  const { ownerId, can } = useOwner();
  const today = localParts(new Date(), venue.timezone).date;
  const lastWeekDate = addDays(today, -7);
  const v = encodeURIComponent(venue.id);

  const { courts, reload: reloadCourts } = useCourts(ownerId, venue.id, today);
  const lastWeek = useResource<{ bookings: OwnerBooking[] }>(
    ownerPath(ownerId, `/bookings?venueId=${v}&from=${lastWeekDate}&to=${lastWeekDate}`),
  );
  const series = useResource<{ series: SeriesJson[] }>(ownerPath(ownerId, `/series?venueId=${v}&status=requested`));
  // Wallet payments to check on any date: the count, and the soonest game for when today has none.
  const toVerify = useResource<{ bookings: OwnerBooking[]; total?: number }>(
    ownerPath(ownerId, `/bookings?venueId=${v}&scope=to_verify&sort=date-asc&page=1&pageSize=1`),
    { keepOnError: true },
  );
  const reviews = useResource<{ reviews: OwnerReviewJson[] }>(
    can('review.manage') ? ownerPath(ownerId, `/reviews?venueId=${v}&limit=${REVIEW_SCAN}`) : null,
  );

  return {
    courts,
    reloadCourts,
    reloadToVerify: toVerify.reload,
    toVerify:
      toVerify.state.status === 'ready'
        ? { total: toVerify.state.data.total ?? 0, first: toVerify.state.data.bookings.find(awaitsVerification) ?? null }
        : null,
    lastWeek: lastWeek.state.status === 'ready' ? lastWeek.state.data.bookings : null,
    requests: series.state.status === 'ready' ? series.state.data.series : null,
    lowReviews:
      reviews.state.status === 'ready'
        ? reviews.state.data.reviews.filter((r) => r.stars <= LOW_STARS && !r.reply && !r.hidden)
        : null,
  };
}
