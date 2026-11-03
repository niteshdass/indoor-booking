import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatMoney, PROVIDER_NAMES } from '@booking/shared';
import { requireSignIn } from '../../../src/auth/requireSignIn';
import { useAuth } from '../../../src/auth/useAuth';
import { CancelSheet } from '../../../src/bookings/CancelSheet';
import { amountDue, bookingWhen, CANCELLABLE, manualPending, mapsUrl } from '../../../src/bookings/format';
import { StatusBadge } from '../../../src/bookings/StatusBadge';
import type { PlayerBooking } from '../../../src/bookings/types';
import { apiGet, ApiError } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { usePayBooking } from '../../../src/payment/usePayBooking';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Button, Card, Text } from '../../../src/ui';

/** The venue's coordinates (the booking carries none). Best effort: without them the Maps link is simply hidden. */
function useVenueLocation(slug: string | undefined): { lat: number; lng: number } | null {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    setLocation(null);
    if (!slug) return;
    let live = true;
    apiGet<{ venue: { location?: { lat: number; lng: number } | null } }>(`/venues/${encodeURIComponent(slug)}`).then(
      (r) => {
        const l = r.venue.location;
        if (live && l && Number.isFinite(l.lat) && Number.isFinite(l.lng)) setLocation(l);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [slug]);
  return location;
}

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.space2 }}>
      <Text tone="muted" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text tone="strong" weight={strong ? 'bold' : 'medium'} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One booking: reference, venue, court, venue-local time, amounts and status, with Pay now (awaiting payment),
 * Open in Maps, Book again and Cancel. Refetches on foreground via usePayBooking, so a payment finished elsewhere shows.
 * Arriving with `confirming=1` (a card payment whose confirmation is late), an awaiting booking says the payment was
 * received and hides Pay now rather than inviting a second charge.
 */
export default function BookingDetailScreen() {
  // `confirming=1`: the pay screen saw the card charged but gave up waiting for the webhook.
  const { id = '', confirming } = useLocalSearchParams<{ id: string; confirming?: string }>();
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { state, refetch, setBooking } = usePayBooking(id, auth.status === 'signedIn');
  const [cancelOpen, setCancelOpen] = useState(false);
  const booking = state.status === 'ready' ? state.booking : null;
  const location = useVenueLocation(booking?.venue?.slug);

  const goBack = () => (router.canGoBack?.() ? router.back() : router.replace('/'));
  const frame = (children: ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'flex-start' }}>
          <Button label={tr('mobile.venue.back')} variant="ghost" onPress={goBack} />
        </View>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('booking.title')}
        </Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
  const spinner = <ActivityIndicator accessibilityLabel={tr('common.loading')} />;

  if (auth.status === 'loading') return frame(spinner);
  if (auth.status === 'signedOut') {
    return frame(
      <>
        <Text tone="muted">{tr('mobile.bookings.signedOut')}</Text>
        <Button label={tr('mobile.account.signedOutCta')} onPress={() => requireSignIn(router, `/booking/${encodeURIComponent(id)}`)} />
      </>,
    );
  }
  if (auth.status === 'offline') {
    return frame(
      <>
        <Text tone="danger" accessibilityRole="alert">
          {tr('errors.network_error')}
        </Text>
        <Button label={tr('search.retry')} onPress={auth.retry} />
      </>,
    );
  }
  if (state.status === 'error') {
    const missing = state.error instanceof ApiError && state.error.status === 404;
    return frame(
      <>
        <Text tone="danger" accessibilityRole="alert">
          {missing ? tr('errors.not_found') : errorMessage(state.error, tr)}
        </Text>
        {missing ? null : <Button label={tr('search.retry')} onPress={() => void refetch()} />}
      </>,
    );
  }
  if (!booking) return frame(spinner);

  const lang = i18n.language;
  const fmt = (n: number) => formatMoney(n, booking.currency, lang);
  const { day, range } = bookingWhen(booking, lang);
  const waiting = manualPending(booking);
  // A wallet payment waiting on an expired booking was sent after its times were taken.
  const late = waiting && booking.status === 'expired';
  const holdLive = !booking.holdExpiresAt || Date.parse(booking.holdExpiresAt) > Date.now();
  const paymentConfirming = confirming === '1' && booking.status === 'awaiting_payment';
  const showPayNow = booking.status === 'awaiting_payment' && holdLive && !waiting && !paymentConfirming;
  const due = amountDue(booking);
  const venue = booking.venue;
  const canBookAgain = !!venue && booking.slots.length > 0 && booking.status !== 'awaiting_payment';

  return frame(
    <>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: t.space2 }}>
          {venue ? (
            <Text variant="title" tone="strong" style={{ flexShrink: 1 }}>
              {venue.name}
            </Text>
          ) : null}
          <StatusBadge status={booking.status} toVerify={waiting && booking.status === 'pending'} />
        </View>
        {venue ? (
          <Text tone="muted">{venue.address && venue.address !== venue.city ? `${venue.address}, ${venue.city}` : venue.city}</Text>
        ) : null}
        <Text tone="strong">{[booking.turf?.name, day, range].filter(Boolean).join(' · ')}</Text>
        {!venue ? <Text variant="caption" tone="muted">{tr('booking.timesUtc')}</Text> : null}

        {booking.manualPayment && waiting ? (
          <Text accessibilityRole="alert" tone="info">
            {late
              ? tr('booking.manualLate')
              : tr('booking.manualWaiting', { provider: PROVIDER_NAMES[booking.manualPayment.provider], trxId: booking.manualPayment.trxId })}
          </Text>
        ) : null}
        {booking.status === 'pending' && !waiting ? <Text tone="muted">{tr('booking.pendingNote')}</Text> : null}
        {paymentConfirming ? (
          <Text accessibilityRole="alert" tone="info">
            {tr('mobile.pay.receivedConfirming')}
          </Text>
        ) : null}

        <Fact label={tr('booking.reference')} value={booking.reference} strong />
        <Fact label={tr('booking.total')} value={fmt(booking.total)} strong />
        <Fact label={tr('booking.paid')} value={fmt(booking.amountPaid)} />
        {due > 0 ? <Fact label={tr('checkout.payLater')} value={fmt(due)} /> : null}
        {booking.amountRefunded > 0 ? <Fact label={tr('booking.refunded')} value={fmt(booking.amountRefunded)} /> : null}
      </Card>

      {showPayNow ? <Button label={tr('booking.payNow')} onPress={() => router.push({ pathname: '/booking/[id]/pay', params: { id } })} /> : null}
      {location ? <Button label={tr('mobile.bookings.openMaps')} variant="secondary" onPress={() => void Linking.openURL(mapsUrl(location)).catch(() => undefined)} /> : null}
      {canBookAgain && venue ? (
        <Button
          label={tr('bookAgain.open')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/venue/[slug]', params: { slug: venue.slug, turfId: booking.turfId } })}
        />
      ) : null}
      {CANCELLABLE.has(booking.status) ? <Button label={tr('cancel.open')} variant="secondary" tone="danger" onPress={() => setCancelOpen(true)} /> : null}

      <CancelSheet
        visible={cancelOpen}
        bookingId={id}
        onClose={() => setCancelOpen(false)}
        onCancelled={(next: PlayerBooking) => {
          setBooking(next);
          setCancelOpen(false);
        }}
      />
    </>,
  );
}
