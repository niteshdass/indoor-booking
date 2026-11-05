import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import {
  bdMobileDigits,
  currencyExponent,
  formatBdMobile,
  formatMoney,
  normalizeTrxId,
  parseMoney,
  type OwnerPlatformFeeJson,
  type PlatformBalanceJson,
} from '@booking/shared';
import { ApiError, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../labels';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Chip, Field, Sheet, Text } from '../../ui';

type Methods = OwnerPlatformFeeJson['methods'];
export type WalletMethod = 'bkash' | 'nagad';

/** The wallet methods the admin offers, in the web's order. Card (Stripe) stays on the web. */
export const WALLET_ORDER: WalletMethod[] = ['bkash', 'nagad'];
export const walletMethods = (methods: Methods): WalletMethod[] => WALLET_ORDER.filter((m) => methods[m] !== null);

const ACTION_KEY = { personal: 'send', agent: 'agent', merchant: 'merchant' } as const;

/** Same as web `forInput`: minor units as a plain decimal for the amount field. */
const forInput = (minor: number, currency: string) => {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
};

/**
 * Pay the platform fee in one currency with bKash or Nagad: send money to the admin's number, then the TrxID is checked
 * by an admin. Mirrors the wallet branch of apps/web/src/owner/platform/PayPlatformDialog.tsx.
 * Mount it fresh for each open (key it), like the web dialog.
 */
export function PayPlatformSheet({
  visible,
  balance,
  methods,
  onClose,
  onChanged,
}: {
  visible: boolean;
  balance: PlatformBalanceJson;
  methods: Methods;
  onClose(): void;
  /** Something was paid or the balance turned out stale: fetch it again. */
  onChanged(): void;
}) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const offered = walletMethods(methods);
  const [method, setMethod] = useState<WalletMethod | undefined>(offered[0]);
  const [amountText, setAmountText] = useState(() => forInput(balance.payable, balance.currency));
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [trxError, setTrxError] = useState<string | undefined>();
  const [senderError, setSenderError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // The admin removed the picked method (reload after method_unavailable): fall back to what is still offered.
  const current = method && offered.includes(method) ? method : offered[0];
  const wallet = current ? methods[current] : null;
  const provider = current ? tr(`admin.payouts.method.${current}`) : '';
  const max = formatMoney(balance.payable, balance.currency, i18n.language);
  const close = () => {
    if (!inflight.current) onClose();
  };

  /** Minor units within what can be paid now, or undefined with the field error set. Same rules as web. */
  const readAmount = (): number | undefined => {
    let amount: number;
    try {
      amount = parseMoney(amountText.trim(), balance.currency);
    } catch {
      setAmountError(tr('owner.platformFee.dialog.amountInvalid'));
      return undefined;
    }
    if (amount < 1) {
      setAmountError(tr('owner.platformFee.dialog.amountInvalid'));
      return undefined;
    }
    if (amount > balance.payable) {
      setAmountError(tr('owner.platformFee.dialog.amountOver', { max }));
      return undefined;
    }
    setAmountError(undefined);
    return amount;
  };

  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const text = errorMessage(err, tr);
    if (code === 'amount_exceeds_balance') {
      setAmountError(text);
      onChanged();
    } else if (code === 'invalid_trx_id' || code === 'duplicate_trx') setTrxError(text);
    else if (code === 'invalid_sender') setSenderError(text);
    else {
      setError(text);
      if (code === 'method_unavailable') onChanged();
    }
  };

  const submit = async () => {
    if (inflight.current || !current) return;
    setError(null);
    const amount = readAmount();
    const trxId = normalizeTrxId(trx);
    const okSender = bdMobileDigits(sender) !== null;
    setTrxError(trxId ? undefined : tr('payment.wallet.trxInvalid'));
    setSenderError(okSender ? undefined : tr('payment.wallet.senderInvalid'));
    if (amount === undefined || !trxId || !okSender) return;
    inflight.current = true;
    setBusy(true);
    try {
      await apiPost(ownerPath(ownerId, '/platform-payouts'), {
        currency: balance.currency,
        amount,
        method: current,
        trxId,
        senderNumber: sender.trim(),
      });
      if (mounted.current) setDone(true);
      onChanged();
    } catch (err) {
      if (mounted.current) fail(err);
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const copy = async () => {
    if (!wallet) return;
    try {
      await Clipboard.setStringAsync(wallet.number);
      if (mounted.current) setCopied(true);
    } catch {
      /* the number stays selectable */
    }
  };

  let body;
  if (done) {
    body = (
      <>
        <View style={{ padding: t.space3, borderRadius: t.radiusMd, backgroundColor: t.successSoft }}>
          <Text tone="success" accessibilityRole="alert">
            {tr('owner.platformFee.dialog.sent')}
          </Text>
        </View>
        <Button variant="secondary" label={tr('common.close')} onPress={onClose} />
      </>
    );
  } else if (!current || !wallet) {
    body = (
      <>
        <Text tone="warning">{tr('owner.platformFee.dialog.noMethods')}</Text>
        <Button variant="secondary" label={tr('common.close')} onPress={onClose} />
      </>
    );
  } else {
    const number = formatBdMobile(wallet.number);
    body = (
      <>
        <Text variant="label" tone="strong">
          {tr('owner.platformFee.dialog.method')}
        </Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {offered.map((m) => (
            <Chip
              key={m}
              selected={current === m}
              disabled={busy}
              onPress={() => {
                setMethod(m);
                setError(null);
                setCopied(false);
              }}
              accessibilityRole="radio"
              accessibilityLabel={tr(`admin.payouts.method.${m}`)}
              accessibilityState={{ checked: current === m, disabled: busy }}
            >
              <Text variant="label">{tr(`admin.payouts.method.${m}`)}</Text>
            </Chip>
          ))}
        </View>
        <Text variant="caption" tone="muted">
          {tr('owner.platformFee.dialog.methodHint.wallet')}
        </Text>

        <Field
          label={tr('owner.platformFee.dialog.amount')}
          hint={tr('owner.platformFee.dialog.amountHint', { max })}
          error={amountError}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          autoComplete="off"
        />

        <View style={{ padding: t.space3, gap: t.space1, borderRadius: t.radiusMd, backgroundColor: t.bgSubtle }}>
          <Text variant="caption" tone="muted">
            {tr('payment.wallet.sendTo')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.space2 }}>
            {/* Selectable so it can be long-pressed and copied too. */}
            <Text variant="heading" tone="strong" selectable style={{ flexShrink: 1 }}>
              {number}
            </Text>
            <Button variant="ghost" label={tr(copied ? 'payment.wallet.copied' : 'payment.wallet.copy')} onPress={() => void copy()} />
          </View>
          <Text variant="caption" tone="muted">
            {tr(`payment.wallet.account.${wallet.accountType}`, { provider })}
          </Text>
          {wallet.note ? <Text variant="caption">{wallet.note}</Text> : null}
        </View>
        <Text tone="muted">
          {tr('owner.platformFee.dialog.steps', { provider, action: tr(`payment.wallet.action.${ACTION_KEY[wallet.accountType]}`) })}
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
        <Text variant="caption" tone="muted">
          {tr('owner.platformFee.dialog.manualHint')}
        </Text>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button label={tr('owner.platformFee.dialog.submitManual')} loading={busy} disabled={busy} onPress={() => void submit()} />
        <Button variant="secondary" label={tr('owner.platformFee.dialog.cancel')} onPress={close} />
      </>
    );
  }

  return (
    <Sheet visible={visible} onClose={close} title={tr('owner.platformFee.dialog.title')} subtitle={tr('owner.platformFee.owe', { amount: formatMoney(balance.balance, balance.currency, i18n.language) })}>
      {body}
    </Sheet>
  );
}
