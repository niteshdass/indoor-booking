import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@booking/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Field, Sheet, Text } from '../ui';
import type { CancellationPreview, PlayerBooking } from './types';

const REASON_MAX = 300;
/** Once the API says this, confirming again cannot succeed. */
const FINAL_ERRORS = new Set(['too_late', 'invalid_transition']);

type Load = { status: 'loading' } | { status: 'ready'; preview: CancellationPreview } | { status: 'error'; error: unknown };

/**
 * Bottom sheet that shows what the player would get back (`GET …/cancellation`) before anything is cancelled,
 * then cancels (`POST …/cancel`). The confirm button is off while the request is in flight.
 */
export function CancelSheet({ visible, bookingId, onClose, onCancelled }: { visible: boolean; bookingId: string; onClose(): void; onCancelled(booking: PlayerBooking): void }) {
  const { t: tr, i18n } = useTranslation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inflight = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoad({ status: 'loading' });
    setError(null);
    setReason('');
    apiGet<{ preview: CancellationPreview }>(`/me/bookings/${encodeURIComponent(bookingId)}/cancellation`).then(
      (r) => live && setLoad({ status: 'ready', preview: r.preview }),
      (e: unknown) => live && setLoad({ status: 'error', error: e }),
    );
    return () => {
      live = false;
    };
  }, [visible, bookingId, attempt]);

  const confirm = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const res = await apiPost<{ booking: PlayerBooking }>(`/me/bookings/${encodeURIComponent(bookingId)}/cancel`, trimmed ? { reason: trimmed } : {});
      onCancelled(res.booking);
    } catch (e) {
      setError(e);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const close = () => {
    if (!inflight.current) onClose();
  };
  const final = error instanceof ApiError && FINAL_ERRORS.has(error.code);

  return (
    <Sheet visible={visible} onClose={close} title={tr('cancel.title')}>
      {load.status === 'loading' ? <ActivityIndicator accessibilityLabel={tr('common.loading')} /> : null}
      {load.status === 'error' ? (
        <>
          <Text tone="danger" accessibilityRole="alert">
            {errorMessage(load.error, tr)}
          </Text>
          <Button label={tr('search.retry')} variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </>
      ) : null}
      {load.status === 'ready' ? (
        <>
          <Preview preview={load.preview} lang={i18n.language} />
          <Field label={tr('cancel.reason')} value={reason} onChangeText={setReason} maxLength={REASON_MAX} multiline />
        </>
      ) : null}
      {error !== null ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(error, tr)}
        </Text>
      ) : null}
      <Button label={tr('cancel.keep')} variant="secondary" disabled={busy} onPress={close} />
      {load.status === 'ready' && !final ? (
        <Button label={tr('mobile.bookings.confirmCancel')} tone="danger" loading={busy} disabled={busy} onPress={() => void confirm()} />
      ) : null}
    </Sheet>
  );
}

/** Mirrors the web cancel dialog: what was paid, the refund and how it is paid back. */
function Preview({ preview, lang }: { preview: CancellationPreview; lang: string }) {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const fmt = (n: number) => formatMoney(n, preview.currency, lang);
  const paid = preview.amountPaid - preview.amountRefunded;
  if (paid <= 0) return <Text tone="muted">{tr('cancel.nothingPaid')}</Text>;
  const row = (label: string, value: string, strong = false) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: t.space2 }}>
      <Text tone={strong ? 'strong' : 'default'} weight={strong ? 'semibold' : undefined} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text tone="strong" weight={strong ? 'semibold' : undefined}>
        {value}
      </Text>
    </View>
  );
  return (
    <View style={{ gap: t.space2 }} accessibilityLiveRegion="polite">
      {row(tr('cancel.paid'), fmt(paid))}
      {row(tr('cancel.refund', { percent: preview.percent }), fmt(preview.amount), true)}
      <Text variant="caption" tone="muted">
        {preview.rule && preview.rule.minHoursBefore !== null
          ? tr('cancel.rule', { hours: preview.rule.minHoursBefore, percent: preview.rule.percent })
          : tr('cancel.noRule')}
      </Text>
      {preview.amount === 0 ? (
        <Text>{tr('cancel.noRefund')}</Text>
      ) : (
        <>
          {preview.card > 0 ? <Text>{tr('cancel.toCard', { amount: fmt(preview.card) })}</Text> : null}
          {preview.wallet > 0 ? <Text>{tr('cancel.toWallet', { amount: fmt(preview.wallet) })}</Text> : null}
          {preview.cash > 0 ? <Text>{tr('cancel.cashAtVenue', { amount: fmt(preview.cash) })}</Text> : null}
        </>
      )}
    </View>
  );
}
