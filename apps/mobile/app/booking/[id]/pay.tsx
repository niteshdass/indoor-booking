import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { formatMoney, localParts, PROVIDER_NAMES, type WalletProvider } from '@booking/shared';
import { requireSignIn } from '../../../src/auth/requireSignIn';
import { useAuth } from '../../../src/auth/useAuth';
import type { PaymentOptions, PaymentStart, PlayerBooking } from '../../../src/bookings/types';
import { ApiError, apiGet, apiPost } from '../../../src/lib/api';
import { errorMessage } from '../../../src/lib/errors';
import { openSslcommerz } from '../../../src/payment/sslcommerz';
import { payWithStripe } from '../../../src/payment/stripe';
import { useConfirmPoll } from '../../../src/payment/useConfirmPoll';
import { usePayBooking } from '../../../src/payment/usePayBooking';
import { WalletForm, type ManualOutcome } from '../../../src/payment/WalletForm';
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
 * After a card payment or the online checkout, the booking is polled (useConfirmPoll) until the webhook lands.
 */
export default function PayScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { state, refetch, setBooking } = usePayBooking(id, auth.status === 'signedIn');

  const [options, setOptions] = useState<OptionsState>({ status: 'idle' });
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [method, setMethod] = useState<Method | null>(null);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [holdLapsed, setHoldLapsed] = useState(false);
  /**
   * A payment may have gone through and the booking is polled until the webhook confirms it. 'card': PaymentSheet said
   * completed, so Pay is never offered again. 'online': the SSLCommerz browser closed, outcome unknown.
   */
  const [confirming, setConfirming] = useState<'card' | 'online' | null>(null);
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

  /** `stillConfirming`: the card was charged but the webhook has not landed yet, so the detail screen holds off Pay now. */
  const goToBooking = useCallback(
    (stillConfirming = false) => {
      if (navigated.current) return;
      navigated.current = true;
      router.replace({ pathname: '/booking/[id]', params: stillConfirming ? { id, confirming: '1' } : { id } });
    },
    [id, router],
  );

  useEffect(() => {
    // After a completed card payment any change of status (even expired) is the detail screen's to show.
    if (settled || (confirming === 'card' && !!status && !awaiting)) goToBooking();
  }, [settled, confirming, status, awaiting, goToBooking]);

  const onConfirmTimeout = useCallback(() => {
    // A charged card goes on regardless; an online checkout the player may have just closed offers paying again.
    if (confirming === 'card') goToBooking(true);
    else setConfirming(null);
  }, [confirming, goToBooking]);
  useConfirmPoll(confirming !== null && awaiting, refetch, onConfirmTimeout);

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
          setConfirming('card');
          return;
        }
        setNote(out.kind === 'canceled' ? { kind: 'cancelled' } : { kind: 'failed', message: out.message });
      } else {
        await openSslcommerz(start.payment.url);
        // The browser closes before the gateway's callback may have reached us: still awaiting means "not yet known".
        setConfirming('online');
        return;
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

  const onWalletDone = async (_outcome: ManualOutcome, next: PlayerBooking) => {
    // Show what the submit returned straight away, so a failed refetch cannot leave the old form up.
    setBooking(next);
    setHoldLapsed(false);
    await refetch();
  };
  const goBack = () => (router.canGoBack?.() ? router.back() : router.replace('/'));

  const backToVenue = () => {
    if (booking?.venue) router.replace({ pathname: '/venue/[slug]', params: { slug: booking.venue.slug } });
    else router.back();
  };

  const frame = (children: ReactNode) => (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: t.bgPage }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: t.space4, gap: t.space4 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: 'flex-start' }}>
            <Button label={tr('mobile.venue.back')} variant="ghost" onPress={goBack} />
          </View>
          <Text variant="heading" tone="strong" accessibilityRole="header">
            {tr('payment.title')}
          </Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
  const spinner = <ActivityIndicator accessibilityLabel={tr('common.loading')} />;

  if (auth.status === 'loading') return frame(spinner);
  if (auth.status === 'signedOut') {
    // Sign-in opens by itself once; backing out of it lands here, with a way to open it again.
    return frame(
      <Button label={tr('mobile.pay.signInToPay')} onPress={() => requireSignIn(router, `/booking/${encodeURIComponent(id)}/pay`)} />,
    );
  }
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

  const waitingResult = confirming !== null && awaiting;
  if (settled || confirming === 'card' || waitingResult) {
    const waiting = status === 'pending' && booking.manualPayment?.status === 'pending';
    return frame(
      <>
        {header}
        <Card accessibilityLiveRegion="polite">
          {/* While a payment is being confirmed, "Awaiting payment" would read as if nothing happened. */}
          {status && !waitingResult ? (
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
          {waitingResult ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space2 }}>
              <ActivityIndicator color={t.textMuted} />
              <Text tone="muted" style={{ flexShrink: 1 }}>
                {tr(confirming === 'card' ? 'mobile.pay.confirming' : 'mobile.pay.checking')}
              </Text>
            </View>
          ) : null}
        </Card>
      </>,
    );
  }

  // A Transaction ID came in after the hold ended; if the slots went meanwhile the venue refunds it.
  if (expired && booking.manualPayment) {
    return frame(
      <>
        {header}
        <Card accessibilityLiveRegion="polite">
          <Text variant="title" tone="strong">
            {tr('mobile.pay.submitted')}
          </Text>
          <Text>{tr('booking.manualLate')}</Text>
          <Text variant="caption" tone="muted">{`${PROVIDER_NAMES[booking.manualPayment.provider]} · ${booking.manualPayment.trxId}`}</Text>
          <Button label={tr('payment.backToVenue')} variant="secondary" onPress={backToVenue} />
        </Card>
      </>,
    );
  }

  // Awaiting payment, or a hold that ran out: once it has, only a wallet transfer already made can still come in.
  const tabs: { key: Method; label: string }[] = opts
    ? [
        ...(!expired && opts.sslcommerz ? [{ key: 'online' as const, label: tr('payment.online.tab') }] : []),
        ...(!expired && opts.card ? [{ key: 'card' as const, label: tr('payment.wallet.card') }] : []),
        ...opts.wallets.map((w) => ({ key: w.provider, label: PROVIDER_NAMES[w.provider] })),
      ]
    : [];
  const current: Method | null = expired && (method === null || method === 'card' || method === 'online') ? (opts?.wallets[0]?.provider ?? null) : method;
  const wallet = opts?.wallets.find((w) => w.provider === current);

  // Every branch below keeps its place, so the wallet form (and a typed Transaction ID) survives the hold running out.
  return frame(
    <>
      {header}
      {expired ? (
        <Card>
          <Text tone="strong" accessibilityRole="alert">
            {tr('mobile.pay.holdExpired')}
          </Text>
          <Button label={tr('payment.backToVenue')} variant={wallet ? 'secondary' : 'primary'} onPress={backToVenue} />
        </Card>
      ) : (
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
      )}

      {options.status === 'loading' || options.status === 'idle' ? spinner : null}
      {options.status === 'error' ? (
        <View style={{ gap: t.space2 }}>
          <Text tone="danger" accessibilityRole="alert">
            {tr('payment.loadFailed')}
          </Text>
          <Button label={tr('search.retry')} onPress={() => setOptionsAttempt((n) => n + 1)} />
        </View>
      ) : null}
      {opts && tabs.length === 0 && !expired ? <Text tone="muted">{tr('checkout.noMethods')}</Text> : null}

      {tabs.length > 1 ? (
        <View accessibilityRole="tablist" accessibilityLabel={tr('payment.wallet.tabs')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {tabs.map((tab) => {
            const active = tab.key === current;
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
          {expired ? (
            <Text variant="label" tone="muted">
              {tr('booking.lateEntry')}
            </Text>
          ) : null}
          <WalletForm
            key={wallet.provider}
            bookingId={id}
            wallet={wallet}
            amount={amount}
            currency={currency}
            holdEnded={expired}
            disabled={paying}
            onDone={onWalletDone}
          />
        </Card>
      ) : null}

      {opts && !expired && (current === 'card' || current === 'online') ? (
        <Card>
          {current === 'online' ? <Text tone="muted">{tr('payment.online.body')}</Text> : null}
          {note ? (
            <Text tone={note.kind === 'cancelled' ? 'strong' : 'danger'} accessibilityRole="alert">
              {note.kind === 'cancelled' ? tr('payment.returned.cancelled') : (note.message ?? tr('payment.returned.failed'))}
            </Text>
          ) : null}
          <Button
            label={current === 'card' ? tr('payment.payNow', { amount: sum }) : tr('payment.online.continue')}
            loading={paying}
            disabled={paying}
            onPress={() => void pay()}
          />
        </Card>
      ) : null}
    </>,
  );
}
