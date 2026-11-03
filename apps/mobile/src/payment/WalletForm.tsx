import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Trans, useTranslation } from 'react-i18next';
import { bdMobileDigits, formatBdMobile, formatMoney, normalizeTrxId, PROVIDER_NAMES, type ManualWallet } from '@booking/shared';
import type { PlayerBooking } from '../bookings/types';
import { ApiError, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Field, Text } from '../ui';

export type ManualOutcome = 'pending' | 'slots_taken';

const ACTION_KEY = { personal: 'send', agent: 'agent', merchant: 'merchant' } as const;

export interface WalletFormProps {
  bookingId: string;
  wallet: ManualWallet;
  /** Minor units still due on the booking (the group's remaining advance). */
  amount: number;
  currency: string;
  /** The hold ran out: the form still takes a Transaction ID for money already sent. */
  holdEnded: boolean;
  /** True while the screen is busy with another payment; the submit waits. */
  disabled?: boolean;
  /** The submission was accepted; `booking` is the server's copy after it. The form stays busy until this settles. */
  onDone(outcome: ManualOutcome, booking: PlayerBooking): Promise<void> | void;
}

/** Send money to the venue's wallet number, then tell us the Transaction ID. Mirrors apps/web/src/payment/WalletPayForm.tsx. */
export function WalletForm({ bookingId, wallet, amount, currency, holdEnded, disabled, onDone }: WalletFormProps) {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');
  const [trxError, setTrxError] = useState<string | undefined>();
  const [senderError, setSenderError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const provider = PROVIDER_NAMES[wallet.provider];
  const sum = formatMoney(amount, currency, i18n.language);
  const number = formatBdMobile(wallet.number);

  const submit = async () => {
    if (inflight.current) return;
    const trxId = normalizeTrxId(trx);
    const okSender = bdMobileDigits(sender) !== null;
    setError(null);
    setTrxError(trxId ? undefined : tr('payment.wallet.trxInvalid'));
    setSenderError(okSender ? undefined : tr('payment.wallet.senderInvalid'));
    if (!trxId || !okSender) return;
    inflight.current = true;
    setBusy(true);
    try {
      const res = await apiPost<{ booking: PlayerBooking; outcome: ManualOutcome }>(`/bookings/${encodeURIComponent(bookingId)}/payments/manual`, {
        provider: wallet.provider,
        trxId,
        senderNumber: sender.trim(),
      });
      await onDone(res.outcome, res.booking);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && err.code === 'trx_id_used') setTrxError(errorMessage(err, tr));
      else setError(errorMessage(err, tr));
    } finally {
      // Whatever came after the submit (the screen usually moves on), never leave the button spinning.
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View style={{ gap: t.space3 }}>
      <Text variant="title" tone="strong">
        {tr('payment.wallet.send', { amount: sum })}
      </Text>
      {holdEnded ? (
        <View style={{ padding: t.space3, borderRadius: t.radiusMd, backgroundColor: t.infoSoft }}>
          <Text tone="info">{tr('payment.wallet.holdEnded')}</Text>
        </View>
      ) : null}

      <View style={{ padding: t.space3, gap: t.space1, borderRadius: t.radiusMd, backgroundColor: t.bgSubtle }}>
        <Text variant="caption" tone="muted">
          {tr('payment.wallet.sendTo')}
        </Text>
        {/* Selectable so it can be long-pressed and copied. */}
        <Text variant="heading" tone="strong" selectable>
          {number}
        </Text>
        <Text variant="caption" tone="muted">
          {tr(`payment.wallet.account.${wallet.accountType}`, { provider })}
        </Text>
        {wallet.note ? <Text variant="caption">{wallet.note}</Text> : null}
      </View>

      <Text>
        <Trans
          i18nKey="payment.wallet.steps"
          values={{ provider, action: tr(`payment.wallet.action.${ACTION_KEY[wallet.accountType]}`), number, amount: sum }}
          components={{ num: <Text weight="semibold" tone="strong" /> }}
          shouldUnescape
        />
      </Text>

      <Field
        label={tr('payment.wallet.trxId')}
        hint={tr('payment.wallet.trxHint', { provider })}
        error={trxError}
        value={trx}
        onChangeText={setTrx}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect={false}
      />
      <Field
        label={tr('payment.wallet.sender')}
        hint={tr('payment.wallet.senderHint', { provider })}
        error={senderError}
        value={sender}
        onChangeText={setSender}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label={tr('payment.wallet.submit')} loading={busy} disabled={busy || disabled} onPress={() => void submit()} />
      <Text variant="caption" tone="muted">
        {tr('payment.wallet.hint')}
      </Text>
    </View>
  );
}
