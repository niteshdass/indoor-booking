import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { requireSignIn } from '../../src/auth/requireSignIn';
import { useAuth } from '../../src/auth/useAuth';
import { BookingRow } from '../../src/bookings/BookingRow';
import { splitBookings } from '../../src/bookings/format';
import type { PlayerBooking } from '../../src/bookings/types';
import { apiGet } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Screen, Text } from '../../src/ui';

type State = { status: 'loading' } | { status: 'ready'; bookings: PlayerBooking[] } | { status: 'error'; error: unknown };
const TABS = ['upcoming', 'past'] as const;
type Tab = (typeof TABS)[number];

/** Upcoming and past bookings (`GET /me/bookings`, split like the web page). Refetches whenever the tab gains focus. */
export default function BookingsScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const { status, retry } = useAuth();
  const signedIn = status === 'signedIn';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tab, setTab] = useState<Tab>('upcoming');
  const [refreshing, setRefreshing] = useState(false);
  const run = useRef(0);

  /** Latest request wins. A reload keeps the list on screen unless it fails. */
  const load = useCallback(async () => {
    const mine = ++run.current;
    try {
      const res = await apiGet<{ bookings: PlayerBooking[] }>('/me/bookings');
      if (mine === run.current) setState({ status: 'ready', bookings: res.bookings });
    } catch (error) {
      if (mine === run.current) setState({ status: 'error', error });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (signedIn) void load();
    }, [signedIn, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const { upcoming, past } = useMemo(() => (state.status === 'ready' ? splitBookings(state.bookings, Date.now()) : { upcoming: [], past: [] }), [state]);
  const list = tab === 'upcoming' ? upcoming : past;

  const title = (
    <Text variant="heading" tone="strong" accessibilityRole="header">
      {tr('myBookings.title')}
    </Text>
  );

  if (!signedIn) {
    return (
      <Screen>
        {title}
        {status === 'loading' ? <ActivityIndicator accessibilityLabel={tr('common.loading')} /> : null}
        {status === 'offline' ? (
          <>
            <Text tone="muted" accessibilityRole="alert">
              {tr('auth.offline')}
            </Text>
            <Button label={tr('auth.retry')} onPress={retry} />
          </>
        ) : null}
        {status === 'signedOut' ? (
          <>
            <Text tone="muted">{tr('mobile.bookings.signedOut')}</Text>
            <Button label={tr('mobile.account.signedOutCta')} onPress={() => requireSignIn(router, '/bookings')} />
          </>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      {title}
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
        {TABS.map((k) => {
          const active = k === tab;
          return (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityLabel={tr(`myBookings.${k}`)}
              accessibilityState={{ selected: active }}
              onPress={() => setTab(k)}
              style={{
                minHeight: t.controlLg,
                justifyContent: 'center',
                paddingHorizontal: t.space4,
                borderRadius: t.radiusMd,
                borderWidth: t.focusWidth,
                borderColor: active ? t.primary : t.borderSubtle,
                backgroundColor: active ? t.primary : t.bgSurface,
              }}
            >
              <Text variant="label" weight={active ? 'bold' : 'medium'} style={{ color: active ? t.primaryFg : t.textStrong }}>
                {tr(`myBookings.${k}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {state.status === 'loading' ? <ActivityIndicator accessibilityLabel={tr('common.loading')} /> : null}
      {state.status === 'error' ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(state.error, tr)}
          </Text>
          <Button label={tr('search.retry')} onPress={() => void load()} />
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <FlatList
          testID="bookings-list"
          data={list}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ gap: t.space3 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
          renderItem={({ item }) => <BookingRow booking={item} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: item.id } })} />}
          ListEmptyComponent={
            <View style={{ gap: t.space3 }}>
              <Text tone="muted">{tr(tab === 'upcoming' ? 'myBookings.noUpcoming' : 'myBookings.noPast')}</Text>
              {tab === 'upcoming' ? <Button label={tr('myBookings.findVenues')} onPress={() => router.push('/')} /> : null}
            </View>
          }
        />
      ) : null}
    </Screen>
  );
}
