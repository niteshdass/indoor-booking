import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatMoney, localParts, PROVIDER_NAMES, type WalletProvider } from '@booking/shared';
import { requireSignIn } from '../../../src/auth/requireSignIn';
import { useAuth } from '../../../src/auth/useAuth';
import type { PaymentOptions, PaymentStart } from '../../../src/bookings/types';
import { ApiError, apiGet, apiPost } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { openSslcommerz } from '../../../src/payment/sslcommerz';
import { payWithStripe } from '../../../src/payment/stripe';
import { usePayBooking } from '../../../src/payment/usePayBooking';
import { WalletForm } from '../../../src/payment/WalletForm';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Button, Card, Text } from '../../../src/ui';

type Method = 'online' | 'card' | WalletProvider;
type OptionsState = { status: 'idle' | 'loading' } | { status: 'ready'; options: PaymentOptions } | { status: 'error'; error: unknown };
/** What the last payment attempt left to say, under the Pay button. */
type Note = { kind: 'cancelled' } | { kind: 'failed'; message?: string } | null;

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

/** Seconds tick while a hold runs, so the countdown and the expiry check stay current. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Pays a booking that is awaiting payment: online checkout (SSLCommerz), card (Stripe PaymentSheet) or a manual
 * wallet transfer. Whatever happens, the booking is fetched again afterwards (and whenever the app returns to the
 * foreground) and its status decides what shows; a settled booking goes on to its detail screen once.
 */
export default function PayScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { state, refetch } = usePayBooking(id, auth.status === 'signedIn');

  const [options, setOptions] = useState<OptionsState>({ status: 'idle' });
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [method, setMethod] = useState<Method | null>(null);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [holdLapsed, setHoldLapsed] = useState(false);
  /** A card payment went through: wait for the detail screen, never offer Pay again. */
  const [completed, setCompleted] = useState(false);
  const inflight = useRef(false);
  const navigated = useRef(false);
  const signInSent = useRef(false);

  const booking = state.status === 'ready' ? state.booking : null;
  const status = booking?.status;
  const awaiting = status === 'awaiting_payment';
  const now = useNow(awaiting && !holdLapsed);
  const holdMs = booking?.holdExpiresAt ? Date.parse(booking.holdExpiresAt) - now : null;
  const expired = status === 'expired' || (awaiting && (holdLapsed || (holdMs !== null && holdMs <= 0)));
  const settled = !!status && status !== 'awaiting_payment' && status !== 'expired';

  useEffect(() => {
    if (auth.status === 'signedOut' && !signInSent.current) {
      signInSent.current = true;
      requireSignIn(router, `/booking/${encodeURIComponent(id)}/pay`);
    }
  }, [auth.status, id, router]);

  const goToBooking = useCallback(() => {
    if (navigated.current) return;
    navigated.current = true;
    router.replace({ pathname: '/booking/[id]', params: { id } });
  }, [id, router]);

  useEffect(() => {
    if (settled) goToBooking();
  }, [settled, goToBooking]);

  // Payment options: needed to pay, and after the hold to still take a Transaction ID for money already sent.
  const needOptions = (awaiting || status === 'expired') && !booking?.manualPayment;
  useEffect(() => {
    if (!needOptions) return;
    let live = true;
    setOptions((o) => (o.status === 'ready' ? o : { status: 'loading' }));
    apiGet<PaymentOptions>(`/bookings/${encodeURIComponent(id)}/payment-options`).then(
      (r) => {
        if (!live) return;
        setOptions({ status: 'ready', options: r });
        setMethod((m) => m ?? (r.sslcommerz ? 'online' : (r.wallets[0]?.provider ?? (r.card ? 'card' : null))));
      },
      (error: unknown) => live && setOptions({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [needOptions, id, optionsAttempt]);

  const pay = async () => {
    if (inflight.current || !booking || (method !== 'card' && method !== 'online')) return;
    inflight.current = true;
    setPaying(true);
    setNote(null);
    try {
      const start = await apiPost<PaymentStart>(`/bookings/${encodeURIComponent(id)}/payment`, { gateway: method === 'card' ? 'stripe' : 'sslcommerz' });
      if (start.payment.gateway === 'stripe') {
        const out = await payWithStripe({
          publishableKey: start.payment.publishableKey,
          clientSecret: start.payment.clientSecret,
          merchantName: booking.venue?.name ?? 'BookaTurf',
        });
        if (out.kind === 'completed') {
          setCompleted(true);
          await refetch();
          goToBooking();
          return;
        }
        setNote(out.kind === 'canceled' ? { kind: 'cancelled' } : { kind: 'failed', message: out.message });
      } else {
        await openSslcommerz(start.payment.url);
      }
      await refetch();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'hold_expired') setHoldLapsed(true);
      else if (err instanceof ApiError && (err.code === 'already_paid' || err.code === 'invalid_transition')) await refetch();
      else setNote({ kind: 'failed', message: errorMessage(err, tr) });
    } finally {
      inflight.current = false;
      setPaying(false);
    }
  };

  const onWalletDone = async () => {
    setHoldLapsed(false);
    await refetch();
  };

  const backToVenue = () => {
    if (booking?.venue) router.replace({ pathname: '/venue/[slug]', params: { slug: booking.venue.slug } });
    else router.back();
  };

  const frame = (children: ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text variant="heading" tone="strong" accessibilityRole="header">
            {tr('payment.title')}
          </Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  const spinner = <ActivityIndicator accessibilityLabel={tr('common.loading')} />;

  if (auth.status === 'loading' || auth.status === 'signedOut') return frame(spinner);
  if (auth.status === 'offline') {
    return frame(
      <View style={{ gap: t.space3 }}>
        <Text tone="danger" accessibilityRole="alert">
          {tr('errors.network_error')}
        </Text>
        <Button label={tr('search.retry')} onPress={auth.retry} />
      </View>,
    );
  }
  if (state.status === 'error') {
    return frame(
      <View style={{ gap: t.space3 }}>
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(state.error, tr)}
        </Text>
        <Button label={tr('search.retry')} onPress={() => void refetch()} />
      </View>,
    );
  }
  if (!booking) return frame(spinner);

  const opts = options.status === 'ready' ? options.options : null;
  const currency = opts?.currency ?? booking.currency;
  const amount = opts?.amount ?? Math.max(0, booking.advanceRequired - booking.amountPaid);
  const sum = formatMoney(amount, currency, i18n.language);
  const tz = booking.venue?.timezone ?? 'UTC';
  const first = booking.slots[0];
  const last = booking.slots.at(-1);
  const day = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${booking.businessDate}T12:00:00Z`));
  const line = [booking.venue?.name, booking.turf?.name, first && last ? `${day} ${localParts(new Date(first.startAt), tz).hm}–${localParts(new Date(last.endAt), tz).hm}` : null]
    .filter(Boolean)
    .join(' · ');
  const header = (
    <Text tone="muted" accessibilityLabel={`${booking.reference}, ${line}`}>
      {`${booking.reference} · ${line}`}
    </Text>
  );

  if (settled || completed) {
    const waiting = status === 'pending' && booking.manualPayment?.status === 'pending';
    return frame(
      <>
        {header}
        <Card accessibilityLiveRegion="polite">
          {status ? (
            <Text variant="title" tone={status === 'confirmed' ? 'success' : 'strong'}>
              {tr(`status.${status}`)}
            </Text>
          ) : null}
          {waiting && booking.manualPayment ? (
            <>
              <Text tone="strong">{tr('mobile.pay.waitingVerify')}</Text>
              <Text variant="caption" tone="muted">{`${PROVIDER_NAMES[booking.manualPayment.provider]} · ${booking.manualPayment.trxId}`}</Text>
            </>
          ) : null}
          {completed && awaiting ? <Text tone="muted">{tr('mobile.pay.checking')}</Text> : null}
        </Card>
      </>,
    );
  }

  const lateWallet = expired && !booking.manualPayment ? opts?.wallets[0] : undefined;
  if (expired) {
    return frame(
      <>
        {header}
        <Card>
          <Text tone="strong" accessibilityRole="alert">
            {tr('mobile.pay.holdExpired')}
          </Text>
          <Button label={tr('payment.backToVenue')} onPress={backToVenue} />
        </Card>
        {lateWallet && opts ? (
          <Card>
            <Text variant="label" tone="muted">
              {tr('booking.lateEntry')}
            </Text>
            <WalletForm bookingId={id} wallet={lateWallet} amount={amount} currency={currency} holdEnded onDone={() => void onWalletDone()} />
          </Card>
        ) : null}
      </>,
    );
  }

  // Awaiting payment with time left on the hold.
  const tabs: { key: Method; label: string }[] = opts
    ? [
        ...(opts.sslcommerz ? [{ key: 'online' as const, label: tr('payment.online.tab') }] : []),
        ...(opts.card ? [{ key: 'card' as const, label: tr('payment.wallet.card') }] : []),
        ...opts.wallets.map((w) => ({ key: w.provider, label: PROVIDER_NAMES[w.provider] })),
      ]
    : [];
  const wallet = opts?.wallets.find((w) => w.provider === method);

  return frame(
    <>
      {header}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: t.space2 }}>
        <Text variant="title" tone="strong">
          {tr('payment.payNow', { amount: sum })}
        </Text>
        {holdMs !== null ? (
          <View style={{ paddingHorizontal: t.space3, paddingVertical: t.space1, borderRadius: t.radiusMd, backgroundColor: t.warningSoft }}>
            <Text variant="caption" weight="semibold" tone="warning" accessibilityLabel={tr('payment.holdEndsIn', { time: clock(holdMs) })}>
              {`⏱ ${tr('payment.holdEndsIn', { time: clock(holdMs) })}`}
            </Text>
          </View>
        ) : null}
      </View>

      {options.status === 'loading' || options.status === 'idle' ? spinner : null}
      {options.status === 'error' ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="danger" accessibilityRole="alert">
            {tr('payment.loadFailed')}
          </Text>
          <Button label={tr('search.retry')} onPress={() => setOptionsAttempt((n) => n + 1)} />
        </View>
      ) : null}
      {opts && tabs.length === 0 ? <Text tone="muted">{tr('checkout.noMethods')}</Text> : null}

      {tabs.length > 1 ? (
        <View accessibilityRole="tablist" accessibilityLabel={tr('payment.wallet.tabs')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {tabs.map((tab) => {
            const active = tab.key === method;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setMethod(tab.key);
                  setNote(null);
                }}
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
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {opts && wallet ? (
        <Card>
          <WalletForm bookingId={id} wallet={wallet} amount={amount} currency={currency} holdEnded={false} disabled={paying} onDone={() => void onWalletDone()} />
        </Card>
      ) : null}

      {opts && (method === 'card' || method === 'online') ? (
        <Card>
          {method === 'online' ? <Text tone="muted">{tr('payment.online.body')}</Text> : null}
          {note ? (
            <Text tone={note.kind === 'cancelled' ? 'strong' : 'danger'} accessibilityRole="alert">
              {note.kind === 'cancelled' ? tr('payment.returned.cancelled') : (note.message ?? tr('payment.returned.failed'))}
            </Text>
          ) : null}
          <Button
            label={method === 'card' ? tr('payment.payNow', { amount: sum }) : tr('payment.online.continue')}
            loading={paying}
            disabled={paying}
            onPress={() => void pay()}
          />
        </Card>
      ) : null}
    </>,
  );
}
