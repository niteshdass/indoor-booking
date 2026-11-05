import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { SeriesJson, SeriesStatus } from '@booking/shared';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useResource } from '../../lib/useResource';
import { useTheme } from '../../theme/ThemeProvider';
import { BackButton, Badge, Button, Chip, Empty, ErrorState, Group, Loading, Row, Screen, Text } from '../../ui';
import { VenueChips } from '../insights/VenueChips';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerTurf, OwnerVenue } from '../types';
import { dateRange, dateTimeLabel, patternSummary, SERIES_TONE, seriesCustomer } from './text';

type Page = { series: SeriesJson[]; nextBefore: string | null };
type Load =
  | { status: 'loading' }
  | { status: 'ready'; items: SeriesJson[]; nextBefore: string | null; more: boolean; moreError: unknown }
  | { status: 'error'; error: unknown };

type Filter = 'requested' | 'active' | 'ended' | 'all';
const FILTERS: Filter[] = ['requested', 'active', 'ended', 'all'];

/** The owner's weekly series for one venue, filtered by status, 50 at a time (GET /owners/:id/series). */
export function SeriesList() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId, venues, can } = useOwner();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const venue = venues.find((v) => v.id === venueId) ?? venues[0];
  return (
    <Screen scroll>
      <BackButton />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space3, flexWrap: 'wrap' }}>
        <Text variant="heading" tone="strong" accessibilityRole="header" style={{ flex: 1 }}>
          {tr('series.title')}
        </Text>
        {venue && can('booking.create') ? (
          <Button
            label={tr('series.owner.newSeries')}
            variant="secondary"
            onPress={() => router.push(ownerHref(ownerId, `/series/new?venue=${encodeURIComponent(venue.id)}`))}
          />
        ) : null}
      </View>
      <Text tone="muted">{tr('mobile.owner.series.intro')}</Text>
      {!can('booking.view') ? (
        <Text tone="muted">{tr('mobile.owner.series.listNoAccess')}</Text>
      ) : !venue ? (
        <Empty>{tr('owner.today.noVenues')}</Empty>
      ) : (
        <>
          {venues.length > 1 ? <VenueChips value={venue.id} onChange={setVenueId} /> : null}
          <Filters venue={venue} value={filter} onChange={setFilter} />
          <SeriesRows key={`${venue.id}|${filter}`} venue={venue} status={filter === 'all' ? null : filter} />
        </>
      )}
    </Screen>
  );
}

function Filters({ venue, value, onChange }: { venue: OwnerVenue; value: Filter; onChange(f: Filter): void }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const { ownerId } = useOwner();
  // Open requests are counted on their chip, like the web nav badge.
  const requests = useResource<Page>(ownerPath(ownerId, `/series?status=requested&venueId=${encodeURIComponent(venue.id)}`));
  const waiting = requests.state.status === 'ready' ? requests.state.data.series.length : 0;
  const more = requests.state.status === 'ready' && requests.state.data.nextBefore !== null;
  const label = (f: Filter) =>
    f === 'requested' ? tr('mobile.owner.series.requests') : f === 'all' ? tr('mobile.owner.series.all') : tr(`series.status.${f}`);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={tr('mobile.owner.series.filterLabel')}
      contentContainerStyle={{ gap: t.space2, paddingVertical: t.space1 }}
    >
      {FILTERS.map((f) => {
        const on = f === value;
        const count = f === 'requested' && waiting > 0 ? `${waiting}${more ? '+' : ''}` : null;
        return (
          <Chip
            key={f}
            selected={on}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count ? `${label(f)}, ${count}` : label(f)}
            onPress={() => onChange(f)}
          >
            <Text variant="label" tone={on ? 'primary' : 'default'} weight={on ? 'semibold' : 'medium'}>
              {label(f)}
            </Text>
            {count ? (
              <Text variant="caption" weight="semibold" tone="warning">
                {count}
              </Text>
            ) : null}
          </Chip>
        );
      })}
    </ScrollView>
  );
}

function SeriesRows({ venue, status }: { venue: OwnerVenue; status: SeriesStatus | null }) {
  const { t: tr, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const lang = i18n.language;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const turfs = useResource<{ turfs: OwnerTurf[] }>(ownerPath(ownerId, `/venues/${encodeURIComponent(venue.id)}/turfs`));
  const turfList = turfs.state.status === 'ready' ? turfs.state.data.turfs : [];

  const pathFor = (before?: string) => {
    const q = new URLSearchParams({ venueId: venue.id });
    if (status) q.set('status', status);
    if (before) q.set('before', before);
    return ownerPath(ownerId, `/series?${q.toString()}`);
  };

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    apiGet<Page>(pathFor())
      .then((p) => live && setLoad({ status: 'ready', items: p.series, nextBefore: p.nextBefore, more: false, moreError: null }))
      .catch((error: unknown) => live && setLoad({ status: 'error', error }));
    return () => {
      live = false;
    };
    // pathFor only depends on the props this component is keyed by.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const showMore = async () => {
    if (load.status !== 'ready' || load.nextBefore === null || load.more) return;
    const { items, nextBefore } = load;
    setLoad({ ...load, more: true, moreError: null });
    try {
      const p = await apiGet<Page>(pathFor(nextBefore));
      setLoad({ status: 'ready', items: [...items, ...p.series], nextBefore: p.nextBefore, more: false, moreError: null });
    } catch (e) {
      setLoad({ status: 'ready', items, nextBefore, more: false, moreError: e });
    }
  };

  if (load.status === 'loading') return <Loading />;
  if (load.status === 'error') return <ErrorState error={load.error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (load.items.length === 0) return <Empty>{tr('series.owner.empty')}</Empty>;

  return (
    <>
      <Group>
        {load.items.map((s) => {
          const turf = turfList.find((x) => x.id === s.turfId);
          const lines = [
            [patternSummary(s, turf, lang), turf?.name].filter(Boolean).join(' · '),
            [dateRange(s, lang), tr('mobile.owner.series.games', { count: s.games.length })].join(' · '),
          ];
          if (s.status === 'requested' && s.respondBy) lines.push(tr('series.owner.answerBy', { when: dateTimeLabel(s.respondBy, venue.timezone, lang) }));
          return (
            <Row
              key={s.id}
              title={seriesCustomer(s, tr)}
              detail={lines.join('\n')}
              right={<Badge label={tr(`series.status.${s.status}`)} tone={SERIES_TONE[s.status]} />}
              onPress={() => router.push(ownerHref(ownerId, `/series/${encodeURIComponent(s.id)}`))}
            />
          );
        })}
      </Group>
      {load.nextBefore !== null ? (
        <Button label={tr('mobile.owner.series.more')} variant="secondary" loading={load.more} onPress={() => void showMore()} />
      ) : null}
      {load.moreError !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(load.moreError, tr)}
        </Text>
      ) : null}
    </>
  );
}
