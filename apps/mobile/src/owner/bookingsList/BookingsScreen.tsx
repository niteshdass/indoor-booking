import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@booking/shared';
import { errorMessage } from '../../lib/errors';
import { useRefocus } from '../../lib/useRefocus';
import { useResource } from '../../lib/useResource';
import { fontFamily } from '../../theme/fonts';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Chip, Empty, ErrorState, Icon, Loading, Text } from '../../ui';
import { ownerHref, ownerPath } from '../labels';
import { useOwner } from '../OwnerProvider';
import type { OwnerTurf } from '../types';
import { BookingListRow } from './BookingListRow';
import { FilterSheet } from './FilterSheet';
import { activeCount, BOOKING_TABS, DEFAULT_SORT, EMPTY_FILTERS, rangeError, type BookingFilters, type BookingTab } from './filters';
import { useBookingPages } from './useBookingPages';

const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Filters a link opens with: a known `tab` with its own order, and `venue` as the venue filter. */
function fromParams(tab: string | undefined, venueId: string | undefined): BookingFilters {
  const known = BOOKING_TABS.find((x) => x === tab);
  return { ...EMPTY_FILTERS, ...(known ? { tab: known, sort: DEFAULT_SORT[known] } : {}), venueId: venueId || null };
}

/** Owner Bookings tab: the web list (tabs, search, filters, sort) as cards that load more on scroll. */
export function BookingsScreen() {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const { ownerId, venues } = useOwner();
  const lang = i18n.language;
  // Other screens link here with `?tab=dues&venue=<id>` (e.g. Insights' "still to collect").
  const params = useLocalSearchParams<{ tab?: string; venue?: string }>();
  const linkKey = `${params.tab ?? ''}|${params.venue ?? ''}`;
  const [requested, setFilters] = useState<BookingFilters>(() => fromParams(params.tab, params.venue));
  const seenLink = useRef(linkKey);
  useEffect(() => {
    // The tab stays mounted, so a later link applies its params too.
    if (seenLink.current === linkKey) return;
    seenLink.current = linkKey;
    if (params.tab || params.venue) setFilters(fromParams(params.tab, params.venue));
  }, [linkKey]);
  const [sheet, setSheet] = useState(false);

  const venue = venues.find((v) => v.id === requested.venueId) ?? null;
  // Courts belong to one venue: the chosen one, or the only one.
  const turfVenue = venue ?? (venues.length === 1 ? venues[0]! : null);
  const turfRes = useResource<{ turfs: OwnerTurf[] }>(turfVenue ? ownerPath(ownerId, `/venues/${encodeURIComponent(turfVenue.id)}/turfs`) : null);
  const turfs = turfRes.state.status === 'ready' ? turfRes.state.data.turfs : null;
  // A court only counts once the venue's courts have loaded and contain it.
  const filters: BookingFilters = { ...requested, venueId: venue?.id ?? null, turfId: turfs?.some((x) => x.id === requested.turfId) ? requested.turfId : null };
  const q = useDebounced(filters.q, SEARCH_DEBOUNCE_MS);
  const invalid = rangeError(filters);
  const list = useBookingPages(ownerId, { ...filters, q, ...(invalid ? { from: null, to: null } : {}) });
  // Back from a booking or another tab: show what changed there.
  useRefocus(list.refreshQuietly);

  const update = (patch: Partial<BookingFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const active = activeCount(filters);
  const home = venue ?? venues[0];
  const showVenue = !filters.venueId && venues.length > 1;
  const dues = filters.tab === 'dues';
  const tabLabel = (x: BookingTab) => (x === 'to_verify' ? tr('status.paymentToCheck') : tr(`owner.bookings.tab.${x}`));

  if (!home) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bgPage, padding: t.space4 }}>
        <Empty>{tr('owner.today.noVenues')}</Empty>
      </SafeAreaView>
    );
  }

  const dueTotal =
    list.due !== undefined
      ? tr('owner.bookings.dueTotal', {
          amount: list.due.length ? list.due.map((d) => formatMoney(d.amount, d.currency, lang)).join(' + ') : formatMoney(0, home.currency, lang),
        })
      : null;
  const filtered = active > 0 || filters.q.trim() !== '';

  const header = (
    <View style={{ gap: t.space3, paddingBottom: t.space3 }}>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('owner.nav.bookings')}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space2 }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space2,
            minHeight: t.controlLg,
            paddingHorizontal: t.space3,
            borderRadius: t.radiusMd,
            backgroundColor: t.controlFill,
          }}
        >
          <Icon name="search" color={t.textMuted} size={t.iconSm} />
          <TextInput
            accessibilityLabel={tr('owner.bookings.search')}
            placeholder={tr('owner.bookings.search')}
            placeholderTextColor={t.textSubtle}
            value={filters.q}
            onChangeText={(v) => update({ q: v })}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{ flex: 1, minHeight: t.controlLg, color: t.textStrong, fontFamily: fontFamily('sans', 'regular', lang), fontSize: t.textMd }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active > 0 ? `${tr('owner.bookings.filters')}, ${tr('owner.bookings.filtersActive', { count: active })}` : tr('owner.bookings.filters')}
          onPress={() => setSheet(true)}
          style={({ pressed }) => ({
            minWidth: t.controlLg,
            minHeight: t.controlLg,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: t.space1,
            paddingHorizontal: t.space2,
            borderRadius: t.radiusMd,
            borderWidth: t.focusWidth,
            borderColor: active > 0 ? t.primary : 'transparent',
            backgroundColor: active > 0 ? t.primarySoft : pressed ? t.controlFillHover : t.controlFill,
          })}
        >
          <Icon name="sliders" color={active > 0 ? t.primary : t.textStrong} size={t.iconMd} />
          {active > 0 ? (
            <Text variant="label" weight="bold" tone="primary">
              {String(active)}
            </Text>
          ) : null}
        </Pressable>
      </View>
      {venues.length > 1 ? (
        <View style={{ flexDirection: 'row' }}>
          <Chip
            selected={venue !== null}
            accessibilityRole="button"
            accessibilityLabel={`${tr('owner.venue')}, ${venue?.name ?? tr('owner.bookings.allVenues')}`}
            onPress={() => setSheet(true)}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space1 }}>
              <Icon name="venue" color={venue ? t.primary : t.textMuted} size={t.iconSm} />
              <Text variant="label" weight={venue ? 'semibold' : 'medium'} tone={venue ? 'primary' : 'default'}>
                {venue?.name ?? tr('owner.bookings.allVenues')}
              </Text>
              <Icon name="chevronDown" color={venue ? t.primary : t.textMuted} size={t.iconSm} />
            </View>
          </Chip>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }} accessibilityRole="tablist" accessibilityLabel={tr('owner.nav.bookings')}>
        {BOOKING_TABS.map((x) => {
          const on = x === filters.tab;
          return (
            <Chip
              key={x}
              selected={on}
              accessibilityRole="tab"
              accessibilityLabel={tabLabel(x)}
              accessibilityState={{ selected: on }}
              // Each tab opens in its own order, as on the web.
              onPress={() => update({ tab: x, sort: DEFAULT_SORT[x] })}
            >
              <Text variant="label" weight={on ? 'semibold' : 'medium'} tone={on ? 'primary' : 'default'}>
                {tabLabel(x)}
              </Text>
            </Chip>
          );
        })}
      </View>
      {invalid ? (
        <Text tone="danger" accessibilityRole="alert">
          {tr(invalid)}
        </Text>
      ) : null}
      {list.status === 'ready' && list.total > 0 ? (
        <Text variant="label" tone="muted">
          {[tr('owner.bookings.count', { count: list.total }), dueTotal].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );

  let empty;
  if (list.status === 'loading') empty = <Loading />;
  else if (list.status === 'error') empty = <ErrorState error={list.error} onRetry={list.retry} />;
  else {
    empty = (
      <View style={{ alignItems: 'center', gap: t.space2, paddingVertical: t.space6 }}>
        <Text weight="semibold" tone="strong" style={{ textAlign: 'center' }}>
          {tr(dues && !filtered ? 'owner.bookings.duesEmpty' : 'owner.bookings.empty')}
        </Text>
        <Text tone="muted" style={{ textAlign: 'center' }}>
          {tr(
            filters.q.trim()
              ? 'owner.bookings.emptySearchHint'
              : active > 0
                ? 'owner.bookings.emptyFilteredHint'
                : dues
                  ? 'owner.bookings.duesEmptyHint'
                  : 'owner.bookings.emptyHint',
          )}
        </Text>
        {filtered ? (
          <Button label={tr('owner.bookings.clearFilters')} variant="secondary" onPress={() => update({ q: '', venueId: null, turfId: null, status: null, from: null, to: null })} />
        ) : null}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      <FlatList
        testID="owner-bookings-list"
        data={list.bookings}
        keyExtractor={(b) => b.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.space4, gap: t.space3 }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        renderItem={({ item }) => {
          const v = venues.find((x) => x.id === item.venueId);
          return (
            <BookingListRow
              booking={item}
              timeZone={v?.timezone ?? home.timezone}
              venueName={showVenue ? v?.name : undefined}
              dues={dues}
              onPress={() => router.push(ownerHref(ownerId, `/booking/${encodeURIComponent(item.id)}`))}
            />
          );
        }}
        onEndReachedThreshold={0.5}
        onEndReached={list.loadMore}
        ListFooterComponent={
          list.loadingMore ? (
            <ActivityIndicator color={t.textMuted} accessibilityLabel={tr('common.loading')} />
          ) : list.moreError ? (
            <View style={{ gap: t.space2, alignItems: 'flex-start' }}>
              <Text tone="danger" accessibilityRole="alert">
                {errorMessage(list.moreError, tr)}
              </Text>
              <Button label={tr('auth.retry')} variant="secondary" onPress={list.loadMore} />
            </View>
          ) : undefined
        }
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} tintColor={t.textMuted} colors={[t.primary]} />}
      />
      <FilterSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        filters={filters}
        onChange={update}
        venues={venues}
        turfs={turfs}
        total={list.status === 'ready' ? list.total : null}
      />
    </SafeAreaView>
  );
}
