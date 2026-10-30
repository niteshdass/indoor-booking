import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { normalizeTrxId, type ManualWallet } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { BookingJson } from '../lib/types';
import { PROVIDER_NAMES, bdMobileDigits, formatBdMobile } from '../lib/wallets';
import { BookingLine, HoldPill } from './BookingLine';
import styles from './PayPage.module.css';

export type ManualOutcome = 'pending' | 'slots_taken';

const ACTION_KEY = { personal: 'send', agent: 'agent', merchant: 'merchant' } as const;

function CopyNumber({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const available = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {available && (
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {t('payment.wallet.copy')}
        </Button>
      )}
      <span className={styles.copied} aria-live="polite">
        {copied ? t('payment.wallet.copied') : ''}
      </span>
    </>
  );
}

/** Pay a booking by sending money to the venue's wallet number, then telling us the Transaction ID. */
export function WalletPayForm({
  booking,
  wallet,
  amount,
  currency,
  msLeft,
  holdEnded,
  onDone,
}: {
  booking: BookingJson;
  wallet: ManualWallet;
  /** Minor units: the whole group's remaining advance. */
  amount: number;
  currency: string;
  msLeft: number;
  /** The hold ran out: the form still takes a Transaction ID for money already sent. */
  holdEnded: boolean;
  onDone(outcome: ManualOutcome): void;
}) {
  const { t, i18n } = useTranslation();
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');
  const [trxError, setTrxError] = useState<string | undefined>();
  const [senderError, setSenderError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const provider = PROVIDER_NAMES[wallet.provider];
  const sum = money(amount, currency, i18n.language);
  const number = formatBdMobile(wallet.number);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (inflight.current) return;
    const trxId = normalizeTrxId(trx);
    const okSender = bdMobileDigits(sender) !== null;
    setError(null);
    setTrxError(trxId ? undefined : t('payment.wallet.trxInvalid'));
    setSenderError(okSender ? undefined : t('payment.wallet.senderInvalid'));
    if (!trxId || !okSender) return;
    inflight.current = true;
    setBusy(true);
    try {
      const res = await apiPost<{ outcome: ManualOutcome }>(`/bookings/${encodeURIComponent(booking.id)}/payments/manual`, {
        provider: wallet.provider,
        trxId,
        senderNumber: sender.trim(),
      });
      onDone(res.outcome);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'trx_id_used') setTrxError(errorMessage(err, t));
      else setError(errorMessage(err, t));
      inflight.current = false;
      setBusy(false);
    }
  };

  return (
    <form className={styles.card} onSubmit={(e) => void onSubmit(e)} noValidate>
      <div className={styles.head}>
        <div className={styles.headTop}>
          <p className={styles.amount}>{t('payment.wallet.send', { amount: sum })}</p>
          {!holdEnded && <HoldPill msLeft={msLeft} />}
        </div>
        <BookingLine booking={booking} />
      </div>
      {holdEnded && <Alert tone="info">{t('payment.wallet.holdEnded')}</Alert>}

      <div className={styles.numberBox}>
        <div className={styles.numberText}>
          <span className={styles.numberLabel}>{t('payment.wallet.sendTo')}</span>
          <span className={styles.number}>{number}</span>
          <span className={styles.meta}>{t(`payment.wallet.account.${wallet.accountType}`, { provider })}</span>
        </div>
        <div className={styles.numberCopy}>
          <CopyNumber value={wallet.number} />
        </div>
        {wallet.note && <p className={styles.note}>{wallet.note}</p>}
      </div>

      <p className={styles.steps}>
        <Trans
          i18nKey="payment.wallet.steps"
          values={{ provider, action: t(`payment.wallet.action.${ACTION_KEY[wallet.accountType]}`), number, amount: sum }}
          components={{ num: <span className={styles.nowrap} /> }}
          shouldUnescape
        />
      </p>

      <TextField
        label={t('payment.wallet.trxId')}
        hint={t('payment.wallet.trxHint', { provider })}
        error={trxError}
        value={trx}
        onChange={(e) => setTrx(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className={styles.mono}
      />
      <TextField
        label={t('payment.wallet.sender')}
        hint={t('payment.wallet.senderHint', { provider })}
        error={senderError}
        value={sender}
        onChange={(e) => setSender(e.target.value)}
        inputMode="tel"
        autoComplete="tel"
        type="tel"
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" block loading={busy} disabled={busy}>
        {t('payment.wallet.submit')}
      </Button>
      <p className={styles.metaSmall}>{t('payment.wallet.hint')}</p>
    </form>
  );
}
