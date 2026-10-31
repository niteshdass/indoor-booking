import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { normalizeTrxId, parseMoney, type OwnerPlatformFeeJson, type OwnerStripePayoutJson, type PayoutMethod, type PlatformBalanceJson } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { forInput, money } from '../../lib/format';
import { bdMobileDigits, formatBdMobile } from '../../lib/wallets';
import { elementsOptions, stripeFor } from '../../payment/stripe';
import { CopyNumber } from '../../payment/WalletPayForm';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import styles from './PlatformFeePage.module.css';

type Methods = OwnerPlatformFeeJson['methods'];
type Stage = { kind: 'form' } | { kind: 'card'; start: OwnerStripePayoutJson } | { kind: 'done'; method: PayoutMethod };

const ORDER: PayoutMethod[] = ['bkash', 'nagad', 'stripe'];
const ACTION_KEY = { personal: 'send', agent: 'agent', merchant: 'merchant' } as const;

/** Card step: the admin's Stripe Payment Element for the intent the API just made. */
function CardForm({ start, onPaid, onBusy }: { start: OwnerStripePayoutJson; onPaid(): void; onBusy(v: boolean): void }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { payout } = start;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || inflight.current) return;
    inflight.current = true;
    onBusy(true);
    setBusy(true);
    setError(null);
    try {
      const res = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/owner/${encodeURIComponent(ownerId)}/platform-fee?paid=1` },
        redirect: 'if_required',
      });
      if (!mounted.current) return;
      if (res.error) setError(res.error.message ?? t('errors.generic'));
      else onPaid();
    } catch (err) {
      if (mounted.current) setError(errorMessage(err, t));
    } finally {
      inflight.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };

  const amount = money(payout.amount, payout.currency, i18n.language);
  return (
    <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
      <p className={styles.lead}>{t('owner.platformFee.dialog.cardLine', { amount })}</p>
      <PaymentElement />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" icon="card" block loading={busy} disabled={!stripe || !elements || busy}>
        {t('owner.platformFee.dialog.payCard', { amount })}
      </Button>
    </form>
  );
}

function CardStep({ start, onPaid, onBusy }: { start: OwnerStripePayoutJson; onPaid(): void; onBusy(v: boolean): void }) {
  const { i18n } = useTranslation();
  const stripe = useMemo(() => stripeFor(start.publishableKey), [start.publishableKey]);
  // Computed once per intent so Elements never sees a changing clientSecret/appearance.
  const options = useMemo(() => elementsOptions(start.clientSecret, i18n.resolvedLanguage), [start.clientSecret, i18n.resolvedLanguage]);
  return (
    <Elements stripe={stripe} options={options}>
      <CardForm start={start} onPaid={onPaid} onBusy={onBusy} />
    </Elements>
  );
}

/**
 * Pay the platform fee in one currency: pick one of the admin's methods, an amount up to what can be paid now, then
 * either the bKash/Nagad TrxID (checked by an admin) or a card through the admin's Stripe (settled by the webhook).
 */
export function PayPlatformDialog({
  open,
  balance,
  methods,
  onClose,
  onChanged,
}: {
  open: boolean;
  balance: PlatformBalanceJson;
  methods: Methods;
  onClose(): void;
  /** Something was paid or the balance turned out stale: fetch it again. */
  onChanged(): void;
}) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const offered = ORDER.filter((m) => methods[m] !== null);
  const [method, setMethod] = useState<PayoutMethod | undefined>(offered[0]);
  const [amountText, setAmountText] = useState(() => forInput(balance.payable, balance.currency));
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [trxError, setTrxError] = useState<string | undefined>();
  const [senderError, setSenderError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  // The card payout the API already made; when only the Stripe load failed, Retry reuses it instead of making another.
  const [created, setCreated] = useState<OwnerStripePayoutJson | null>(null);
  const inflight = useRef(false);
  const fmt = (minor: number) => money(minor, balance.currency, i18n.language);
  const max = fmt(balance.payable);
  const close = () => {
    if (!inflight.current) onClose();
  };

  const wallet = method === 'bkash' || method === 'nagad' ? methods[method] : null;
  const provider = method ? t(`admin.payouts.method.${method}`) : '';

  /** Minor units within what can be paid now, or undefined with the field error set. */
  const readAmount = (): number | undefined => {
    let amount: number;
    try {
      amount = parseMoney(amountText.trim(), balance.currency);
    } catch {
      setAmountError(t('owner.platformFee.dialog.amountInvalid'));
      return undefined;
    }
    if (amount < 1) {
      setAmountError(t('owner.platformFee.dialog.amountInvalid'));
      return undefined;
    }
    if (amount > balance.payable) {
      setAmountError(t('owner.platformFee.dialog.amountOver', { max }));
      return undefined;
    }
    setAmountError(undefined);
    return amount;
  };

  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const text = errorMessage(err, t);
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

  const run = async (work: () => Promise<void>) => {
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (inflight.current || !method) return;
    if (method === 'stripe') {
      const amount = created ? created.payout.amount : readAmount();
      if (amount === undefined) return;
      void run(async () => {
        let start = created;
        if (!start) {
          start = await apiPost<OwnerStripePayoutJson>(ownerPath(ownerId, '/platform-payouts/stripe'), { currency: balance.currency, amount });
          setCreated(start);
          // The pending card payout holds the amount back now.
          onChanged();
        }
        try {
          await stripeFor(start.publishableKey);
        } catch {
          setError(t('payment.loadFailed'));
          return;
        }
        setStage({ kind: 'card', start });
      });
      return;
    }
    const amount = readAmount();
    const trxId = normalizeTrxId(trx);
    const okSender = bdMobileDigits(sender) !== null;
    setTrxError(trxId ? undefined : t('payment.wallet.trxInvalid'));
    setSenderError(okSender ? undefined : t('payment.wallet.senderInvalid'));
    if (amount === undefined || !trxId || !okSender) return;
    void run(async () => {
      await apiPost(ownerPath(ownerId, '/platform-payouts'), { currency: balance.currency, amount, method, trxId, senderNumber: sender.trim() });
      setStage({ kind: 'done', method });
      onChanged();
    });
  };

  const body = () => {
    if (stage.kind === 'done') {
      return (
        <div className={styles.form}>
          <Alert tone="success">{t(stage.method === 'stripe' ? 'owner.platformFee.dialog.received' : 'owner.platformFee.dialog.sent')}</Alert>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      );
    }
    if (stage.kind === 'card') {
      return (
        <div className={styles.form}>
          <CardStep
            start={stage.start}
            onBusy={(v) => {
              inflight.current = v;
            }}
            onPaid={() => {
              setStage({ kind: 'done', method: 'stripe' });
              onChanged();
            }}
          />
          <p className={styles.sub}>{t('owner.platformFee.dialog.cardHold')}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>
              {t('owner.platformFee.dialog.cancel')}
            </Button>
          </div>
        </div>
      );
    }
    if (offered.length === 0 || !method) {
      return (
        <div className={styles.form}>
          <Alert tone="warning">{t('owner.platformFee.dialog.noMethods')}</Alert>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      );
    }
    const number = wallet ? formatBdMobile(wallet.number) : '';
    return (
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <fieldset className={styles.fieldset} disabled={created !== null}>
          <legend className={styles.legend}>{t('owner.platformFee.dialog.method')}</legend>
          <div className={styles.options}>
            {offered.map((m) => (
              <label key={m} className={styles.option}>
                <input
                  type="radio"
                  name="platform-payout-method"
                  className={styles.radio}
                  value={m}
                  checked={method === m}
                  onChange={() => {
                    setMethod(m);
                    setError(null);
                  }}
                />
                <span className={styles.optionLabel}>{t(`admin.payouts.method.${m}`)}</span>
                <span className={styles.optionHint}>{t(`owner.platformFee.dialog.methodHint.${m === 'stripe' ? 'card' : 'wallet'}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          icon="money"
          label={t('owner.platformFee.dialog.amount')}
          hint={t('owner.platformFee.dialog.amountHint', { max })}
          error={amountError}
          value={created ? forInput(created.payout.amount, created.payout.currency) : amountText}
          readOnly={created !== null}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
        />
        {wallet && (
          <>
            <div className={styles.numberBox}>
              <div className={styles.numberText}>
                <span className={styles.numberLabel}>{t('payment.wallet.sendTo')}</span>
                <span className={styles.number}>{number}</span>
                <span className={styles.sub}>{t(`payment.wallet.account.${wallet.accountType}`, { provider })}</span>
              </div>
              <div className={styles.numberCopy}>
                <CopyNumber value={wallet.number} />
              </div>
              {wallet.note && <p className={styles.note}>{wallet.note}</p>}
            </div>
            <p className={styles.muted}>
              {t('owner.platformFee.dialog.steps', { provider, action: t(`payment.wallet.action.${ACTION_KEY[wallet.accountType]}`) })}
            </p>
            <TextField
              icon="hash"
              label={t('payment.wallet.trxId')}
              hint={t('payment.wallet.trxHint', { provider })}
              error={trxError}
              value={trx}
              onChange={(e) => setTrx(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className={styles.monoField}
            />
            <TextField
              icon="phone"
              label={t('payment.wallet.sender')}
              hint={t('payment.wallet.senderHint', { provider })}
              error={senderError}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              type="tel"
            />
          </>
        )}
        {wallet && <p className={styles.sub}>{t('owner.platformFee.dialog.manualHint')}</p>}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={close}>
            {t('owner.platformFee.dialog.cancel')}
          </Button>
          <Button type="submit" icon={method === 'stripe' ? 'card' : 'send'} loading={busy} disabled={busy}>
            {method === 'stripe' ? t('owner.platformFee.dialog.toCard') : t('owner.platformFee.dialog.submitManual')}
          </Button>
        </div>
      </form>
    );
  };

  return (
    <Dialog open={open} onClose={close} title={t('owner.platformFee.dialog.title')}>
      {open && body()}
    </Dialog>
  );
}
