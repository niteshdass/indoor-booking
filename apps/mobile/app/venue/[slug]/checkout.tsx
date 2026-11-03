import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { randomUUID } from 'expo-crypto';
import { formatMoney, type AddonSelection } from '@booking/shared';
import { requireSignIn } from '../../../src/auth/requireSignIn';
import { useAuth } from '../../../src/auth/useAuth';
import type { PlayerBooking } from '../../../src/bookings/types';
import { AddonPicker } from '../../../src/checkout/AddonPicker';
import { PromoCode } from '../../../src/checkout/PromoCode';
import { QuoteSummary } from '../../../src/checkout/QuoteSummary';
import type { OfferedAddon } from '../../../src/checkout/types';
import { isCouponError, useQuote } from '../../../src/checkout/useQuote';
import { ApiError, apiGet, apiPost } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Button, Card, Text } from '../../../src/ui';
import type { PublicVenue } from '../../../src/venue/types';

type Params = { slug: string; turfId: string; date: string; startAts: string };
type VenueState = { status: 'loading' } | { status: 'ready'; venue: PublicVenue } | { status: 'error'; error: unknown };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isTaken = (err: unknown) => err instanceof ApiError && (err.code === 'slot_taken' || err.code === 'slot_unavailable');

/**
 * Checkout for the slots picked on the venue screen: extras, promo code, live total, then Book.
 * Book carries one Idempotency-Key per visit to this screen, kept on every retry (see task-7 report).
 */
export default function CheckoutScreen() {
  const params = useLocalSearchParams<Params>();
  const slug = params.slug ?? '';
  const turfId = params.turfId ?? '';
  const date = params.date ?? '';
  const startAts = useMemo(() => (params.startAts ? params.startAts.split(',').filter(Boolean) : []), [params.startAts]);
  const valid = !!slug && !!turfId && DATE.test(date) && startAts.length > 0 && startAts.every((s) => !Number.isNaN(Date.parse(s)));

  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const auth = useAuth();

  const [venueState, setVenueState] = useState<VenueState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [offered, setOffered] = useState<OfferedAddon[]>([]);
  const [addonsFailed, setAddonsFailed] = useState(false);
  const [selection, setSelection] = useState<AddonSelection[]>([]);
  const quote = useQuote(valid ? slug : '', turfId, date, startAts, selection);

  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState<unknown>(null);
  /**
   * Book failed without a definite answer (offline, 5xx): it may have gone through under the Idempotency-Key, and a
   * retry with that key replays the first body. Extras and the code stay as sent until a definite answer comes back.
   */
  const [locked, setLocked] = useState(false);
  const inflight = useRef(false);
  const mounted = useRef(true);
  const idempotencyKey = useRef<string | null>(null);
  idempotencyKey.current ??= randomUUID();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setVenueState({ status: 'loading' });
    const base = `/venues/${encodeURIComponent(slug)}`;
    apiGet<{ venue: PublicVenue }>(base).then(
      (r) => live && setVenueState({ status: 'ready', venue: r.venue }),
      (error: unknown) => live && setVenueState({ status: 'error', error }),
    );
    apiGet<{ addons: OfferedAddon[] }>(`${base}/turfs/${encodeURIComponent(turfId)}/addons`).then(
      (r) => {
        if (!live) return;
        setOffered(r.addons.filter((a) => a.autoApply === null));
        setAddonsFailed(false);
      },
      () => {
        if (!live) return;
        setOffered([]);
        setAddonsFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [valid, slug, turfId, attempt]);

  const backToVenue = () => router.replace({ pathname: '/venue/[slug]', params: { slug } });

  const book = async () => {
    if (inflight.current || !quote.data) return;
    if (auth.status === 'signedOut') {
      const next = `/venue/${encodeURIComponent(slug)}/checkout?${new URLSearchParams({ turfId, date, startAts: startAts.join(',') }).toString()}`;
      requireSignIn(router, next);
      return;
    }
    if (auth.status === 'offline') {
      auth.retry();
      setBookError(new ApiError(0, 'network_error', 'offline'));
      return;
    }
    inflight.current = true;
    setSubmitting(true);
    setBookError(null);
    try {
      const res = await apiPost<{ booking: PlayerBooking }>(
        `/venues/${encodeURIComponent(slug)}/turfs/${encodeURIComponent(turfId)}/bookings`,
        {
          date,
          startAts,
          addons: selection,
          ...(quote.data.coupon ? { couponCode: quote.data.coupon.code } : {}),
        },
        { 'Idempotency-Key': idempotencyKey.current! },
      );
      if (!mounted.current) return;
      setLocked(false);
      const id = res.booking.id;
      if (res.booking.status === 'awaiting_payment') router.replace({ pathname: '/booking/[id]/pay', params: { id } });
      else router.replace({ pathname: '/booking/[id]', params: { id } });
    } catch (err) {
      if (!mounted.current) return;
      // A 4xx is a definite "no": the server checks the key first, so nothing was kept under it.
      const status = err instanceof ApiError ? err.status : 0;
      setLocked(status === 0 || status >= 500);
      // The code ran out between quote and booking: say so at the field and quote again without it.
      if (isCouponError(err)) quote.refuseCode(err);
      else setBookError(err);
    } finally {
      inflight.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'flex-start' }}>
            <Button label={tr('mobile.venue.back')} variant="ghost" onPress={() => router.back()} />
          </View>
          {children}
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  const problem = (message: string, actions: ReactNode) =>
    frame(
      <View style={{ gap: t.space3 }}>
        <Text tone="danger" accessibilityRole="alert">
          {message}
        </Text>
        {actions}
      </View>,
    );

  if (!valid) return problem(tr('checkout.invalidParams'), <Button label={tr('checkout.backToVenue')} onPress={backToVenue} />);
  if (venueState.status === 'error') {
    return problem(errorMessage(venueState.error, tr), <Button label={tr('search.retry')} onPress={() => setAttempt((n) => n + 1)} />);
  }
  const venue = venueState.status === 'ready' ? venueState.venue : null;
  const data = quote.data;
  if (!venue || (!data && !quote.error)) {
    return frame(<ActivityIndicator accessibilityLabel={tr('common.loading')} />);
  }
  if (!data) {
    // The slots themselves were refused (taken, past, closed) or the quote could not be reached.
    const offline = quote.error instanceof ApiError && quote.error.status === 0;
    return problem(
      errorMessage(quote.error, tr),
      <>
        {offline ? <Button label={tr('search.retry')} onPress={quote.retry} /> : null}
        <Button label={tr('checkout.chooseOtherSlots')} variant={offline ? 'secondary' : 'primary'} onPress={backToVenue} />
      </>,
    );
  }

  const court = venue.turfs.find((x) => x.id === turfId);
  const due = data.quote.advanceRequired;
  const dayLabel = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  const label = due > 0 ? tr('checkout.bookAndPay', { amount: formatMoney(due, data.quote.currency, i18n.language) }) : tr('checkout.book');
  const disabled = quote.busy || submitting || auth.status === 'loading';
  const taken = isTaken(bookError);

  const footer = (
    <View style={{ padding: t.space4, gap: t.space2, backgroundColor: t.bgSurfaceRaised, ...t.shadowMd }}>
      {bookError ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(bookError, tr)}
          </Text>
          {taken ? <Button label={tr('checkout.chooseOtherSlots')} variant="secondary" onPress={backToVenue} /> : null}
        </View>
      ) : auth.status === 'signedOut' ? (
        <Text variant="caption" tone="muted">
          {tr('checkout.accountRequired')}
        </Text>
      ) : null}
      {taken ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled, busy: submitting }}
          disabled={disabled}
          onPress={() => void book()}
          style={{
            minHeight: t.controlLg,
            flexDirection: 'row',
            gap: t.space2,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: t.space4,
            borderRadius: t.radiusMd,
            backgroundColor: t.brand,
            opacity: disabled ? t.opacityMuted : 1,
          }}
        >
          {submitting ? <ActivityIndicator color={t.brandFg} /> : null}
          <Text variant="label" weight="semibold" style={{ color: t.brandFg, textAlign: 'center' }}>
            {label}
          </Text>
        </Pressable>
      )}
    </View>
  );

  return frame(
    <>
      <View style={{ gap: t.space1 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('checkout.title')}
        </Text>
        <Text weight="medium" tone="strong">
          {court ? `${venue.name} · ${court.name}` : venue.name}
        </Text>
        <Text tone="muted">{dayLabel}</Text>
      </View>

      <Card>
        <QuoteSummary quote={data.quote} coupon={data.coupon ?? null} timeZone={venue.timezone} />
        {quote.error ? (
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(quote.error, tr)}
          </Text>
        ) : null}
      </Card>

      {offered.length > 0 || addonsFailed ? (
        <Card>
          <Text variant="title" tone="strong" accessibilityRole="header">
            {tr('checkout.addons')}
          </Text>
          {addonsFailed ? (
            <Text tone="muted">{tr('checkout.addonsUnavailable')}</Text>
          ) : (
            <AddonPicker addons={offered} currency={venue.currency} value={selection} onChange={setSelection} disabled={locked} />
          )}
        </Card>
      ) : null}

      <Card>
        <PromoCode
          applied={data.coupon ?? null}
          currency={data.quote.currency}
          pending={quote.busy && quote.code !== null}
          error={quote.promoError}
          onApply={quote.applyCode}
          onRemove={quote.removeCode}
          disabled={locked}
        />
        {locked ? (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {tr('mobile.checkout.locked')}
          </Text>
        ) : null}
      </Card>
    </>,
    footer,
  );
}
