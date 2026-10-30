import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currencyExponent, parseMoney } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, money } from '../../lib/format';
import { PROVIDER_NAMES, formatBdMobile } from '../../lib/wallets';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking } from '../types';
import shared from './ReasonDialog.module.css';
import styles from './VerifyPaymentDialog.module.css';

type Props = {
  open: boolean;
  booking: OwnerBooking;
  onClose(): void;
  /** The payment was verified or marked not received; receives the booking as the API now has it. */
  onDone(b: OwnerBooking): void;
  /** A 409 means the booking changed under us: the page reloads it. */
  onConflict?(): void;
};

function forInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

function CopyTrx({ value }: { value: string }) {
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
          {t('owner.verify.copy')}
        </Button>
      )}
      <span className={styles.copied} aria-live="polite">
        {copied ? t('owner.verify.copied') : ''}
      </span>
    </>
  );
}

/**
 * Staff check a submitted wallet payment against their own wallet: "Received" verifies it (with the amount that
 * really arrived), "Not received" rejects it after a confirmation inside the dialog.
 */
export function VerifyPaymentDialog({ open, booking, onClose, onDone, onConflict }: Props) {
  const { t, i18n } = useTranslation();
  const { ownerId, venues } = useOwner();
  const mp = booking.manualPayment;
  const due = mp?.amount ?? 0;
  const lang = i18n.language;
  const tz = venues.find((v) => v.id === booking.venueId)?.timezone ?? 'UTC';
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [asking, setAsking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    setText(forInput(due, booking.currency));
    setInvalid(false);
    setAsking(false);
    setError(null);
    // Reset on each open only; a reload under an open dialog must not clobber what was typed.
  }, [open]);

  let received: number | null = null;
  try {
    const n = parseMoney(text.trim(), booking.currency);
    if (n >= 1) received = n;
  } catch {
    received = null;
  }
  const fmt = (n: number) => money(n, booking.currency, lang);

  const post = async (segment: 'verify' | 'reject', body: { amountReceived?: number }) => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ booking: OwnerBooking }>(
        ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}/payments/manual/${segment}`),
        body,
      );
      onDone(res.booking);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) onConflict?.();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const verify = () => {
    if (received === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void post('verify', received === due ? {} : { amountReceived: received });
  };

  if (!mp) return <Dialog open={false} onClose={onClose} title={t('owner.verify.title')}>{null}</Dialog>;

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={t('owner.verify.title')}>
      {open && (
        <form
          className={shared.body}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!asking) verify();
          }}
        >
          <dl className={styles.facts}>
            <dt>{t('owner.verify.provider')}</dt>
            <dd>{PROVIDER_NAMES[mp.provider]}</dd>
            <dt>{t('owner.verify.trxId')}</dt>
            <dd>
              <span className={styles.trx}>{mp.trxId}</span>
              <CopyTrx value={mp.trxId} />
            </dd>
            {mp.senderNumber && (
              <>
                <dt>{t('owner.verify.sentFrom')}</dt>
                <dd>{formatBdMobile(mp.senderNumber)}</dd>
              </>
            )}
            <dt>{t('owner.verify.due')}</dt>
            <dd>{fmt(due)}</dd>
            <dt>{t('owner.verify.submitted')}</dt>
            <dd>{formatDateTime(mp.submittedAt, tz, lang)}</dd>
          </dl>

          {asking ? (
            <>
              <p className={shared.description}>{t('owner.verify.notReceivedAsk')}</p>
              {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
              <div className={shared.actions}>
                <Button type="button" variant="secondary" disabled={submitting} onClick={() => setAsking(false)}>
                  {t('owner.verify.back')}
                </Button>
                <Button type="button" variant="danger" loading={submitting} onClick={() => void post('reject', {})}>
                  {t('owner.verify.notReceivedConfirm')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <TextField
                label={t('owner.verify.amountReceived')}
                inputMode="decimal"
                value={text}
                error={invalid ? t('owner.verify.invalid') : undefined}
                hint={
                  received !== null && received < due
                    ? t('owner.verify.shortfall', { rest: fmt(due - received) })
                    : received !== null && received > due
                      ? t('owner.verify.excess', { extra: fmt(received - due) })
                      : undefined
                }
                onChange={(e) => setText(e.target.value)}
              />
              {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
              <div className={shared.actions}>
                <Button type="button" variant="danger" disabled={submitting} onClick={() => setAsking(true)}>
                  {t('owner.verify.notReceived')}
                </Button>
                <Button type="submit" loading={submitting}>
                  {t('owner.verify.received')}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </Dialog>
  );
}
