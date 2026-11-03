import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatMoney, keepSelectable, localParts, toggleSlot } from '@booking/shared';
import { ApiError, apiGet } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Text } from '../../src/ui';
import { CourtTabs } from '../../src/venue/CourtTabs';
import { DateStrip } from '../../src/venue/DateStrip';
import { ReviewsPreview } from '../../src/venue/ReviewsPreview';
import { SlotGrid } from '../../src/venue/SlotGrid';
import { useSlots } from '../../src/venue/useSlots';
import type { PublicVenue } from '../../src/venue/types';

type State = { status: 'loading' } | { status: 'ready'; venue: PublicVenue } | { status: 'not_found' } | { status: 'error'; error: unknown };

export default function VenueScreen() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [turfId, setTurfId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    apiGet<{ venue: PublicVenue }>(`/venues/${encodeURIComponent(slug)}`).then(
      (r) => live && setState({ status: 'ready', venue: r.venue }),
      (error: unknown) => live && setState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [slug, attempt]);

  const venue = state.status === 'ready' ? state.venue : null;
  const today = useMemo(() => (venue ? localParts(new Date(), venue.timezone).date : ''), [venue]);
  const court = venue ? (venue.turfs.find((x) => x.id === turfId) ?? venue.turfs[0]) : undefined;
  const shownDate = date ?? today;
  const slots = useSlots(slug, venue ? court?.id : undefined, shownDate);
  const day = slots.status === 'ready' ? slots.day : null;

  // Fresh slots (a retry, or another court-day): keep only picks that are still free.
  useEffect(() => {
    if (day) setSelected((s) => keepSelectable(day.slots, s));
  }, [day]);

  const pickCourt = useCallback((id: string) => {
    setTurfId(id);
    setSelected([]);
  }, []);
  const pickDate = useCallback((d: string) => {
    setDate(d);
    setSelected([]);
  }, []);

  const body = (children: React.ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      {children}
    </SafeAreaView>
  );

  if (state.status === 'loading') {
    return body(
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel={tr('common.loading')} />
      </View>,
    );
  }
  if (state.status === 'not_found' || state.status === 'error') {
    return body(
      <View style={{ padding: t.space4, gap: t.space3 }}>
        <Button label={tr('mobile.venue.back')} variant="ghost" onPress={() => router.back()} />
        <Text tone="danger" accessibilityRole="alert">
          {state.status === 'not_found' ? tr('errors.not_found') : errorMessage(state.error, tr)}
        </Text>
        {state.status === 'error' ? <Button label={tr('search.retry')} onPress={() => setAttempt((n) => n + 1)} /> : null}
      </View>,
    );
  }

  const v = state.venue;
  const picked = day ? day.slots.filter((s) => selected.includes(s.startAt)) : [];
  const total = picked.reduce((n, s) => n + (s.price ?? 0), 0);
  const place = v.address && v.address !== v.city ? `${v.address}, ${v.city}` : v.city;
  const sports = [...new Set(v.turfs.flatMap((x) => x.sports))].map((s) => tr(`sports.${s}`)).join(', ');

  const onToggle = (startAt: string) => {
    if (day) setSelected((s) => toggleSlot(day.slots, s, startAt));
  };
  const onContinue = () => {
    if (!court || picked.length === 0) return;
    router.push({
      pathname: '/venue/[slug]/checkout',
      params: { slug: v.slug, turfId: court.id, date: shownDate, startAts: selected.join(',') },
    });
  };

  return body(
    <>
      <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={tr('mobile.venue.back')} variant="ghost" onPress={() => router.back()} />
        </View>
        <View style={{ gap: t.space1 }}>
          <Text variant="heading" tone="strong" accessibilityRole="header">
            {v.name}
          </Text>
          <Text tone="muted">{place}</Text>
          {sports ? <Text variant="caption" tone="muted">{sports}</Text> : null}
        </View>

        {court ? (
          <>
            <Text variant="title" tone="strong" accessibilityRole="header">
              {tr('venue.book')}
            </Text>
            <CourtTabs courts={v.turfs} value={court.id} onChange={pickCourt} />
            <Text variant="caption" tone="muted">
              {[tr(court.indoor ? 'venue.indoor' : 'venue.outdoor'), tr('venue.slotLength', { count: court.slotLengthMin })].join(' · ')}
            </Text>
            <DateStrip today={today} value={shownDate} onChange={pickDate} />
            {slots.status === 'loading' ? <ActivityIndicator accessibilityLabel={tr('common.loading')} /> : null}
            {slots.status === 'error' ? (
              <View style={{ gap: t.space2 }}>
                <Text tone="danger" accessibilityRole="alert">
                  {errorMessage(slots.error, tr)}
                </Text>
                <Button label={tr('search.retry')} onPress={slots.retry} />
              </View>
            ) : null}
            {day ? <SlotGrid day={day} timeZone={v.timezone} selected={selected} onToggle={onToggle} /> : null}
          </>
        ) : (
          <Text tone="muted">{tr('venue.noTurfs')}</Text>
        )}

        <ReviewsPreview slug={slug} rating={v.rating} />
      </ScrollView>

      {court ? (
        <View style={{ padding: t.space4, gap: t.space2, backgroundColor: t.bgSurfaceRaised, ...t.shadowMd }}>
          {picked.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.space2 }} accessibilityLiveRegion="polite">
              <Text weight="semibold" tone="strong">
                {tr('slots.selectedCount', { count: picked.length })}
              </Text>
              <Text weight="semibold" tone="strong">
                {`${tr('venue.total')}: ${formatMoney(total, v.currency, i18n.language)}`}
              </Text>
            </View>
          ) : (
            <Text tone="muted">{tr('slots.pickHint')}</Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('slots.continue')}
            accessibilityState={{ disabled: picked.length === 0 }}
            disabled={picked.length === 0}
            onPress={onContinue}
            style={{
              minHeight: t.controlLg,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: t.space4,
              borderRadius: t.radiusMd,
              backgroundColor: t.brand,
              opacity: picked.length === 0 ? t.opacityMuted : 1,
            }}
          >
            <Text variant="label" weight="semibold" style={{ color: t.brandFg }}>
              {tr('slots.continue')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>,
  );
}
