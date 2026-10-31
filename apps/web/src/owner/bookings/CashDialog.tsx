import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMoney } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { forInput, money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { OwnerBooking } from '../types';
import styles from './ReasonDialog.module.css';

type Props = {
  open: boolean;
  booking: OwnerBooking;
  onClose: () => void;
  onRecorded(b: OwnerBooking): void;
  /** A 409 means the booking changed under us: the page reloads it. */
  onConflict?: () => void;
};

/** Records a cash payment against a booking; defaults to the whole remaining amount. */
export function CashDialog({ open, booking, onClose, onRecorded, onConflict }: Props) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const remaining = booking.total - booking.amountPaid;
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    setText(forInput(remaining, booking.currency));
    setInvalid(false);
    setError(null);
    // Reset on each open only; a reload under an open dialog must not clobber what was typed.
  }, [open]);

  const submit = async () => {
    if (busy.current) return;
    let amount: number;
    try {
      amount = parseMoney(text.trim(), booking.currency);
    } catch {
      setInvalid(true);
      return;
    }
    if (amount < 1 || amount > remaining) {
      setInvalid(true);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setInvalid(false);
    setError(null);
    try {
      const res = await apiPost<{ booking: OwnerBooking }>(
        ownerPath(ownerId, `/bookings/${encodeURIComponent(booking.id)}/payments/cash`),
        amount === remaining ? {} : { amount },
      );
      onRecorded(res.booking);
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) onConflict?.();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={t('owner.cash.title')}>
      {open && (
        <form
          className={styles.body}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField
            icon="money"
            label={t('owner.cash.amount')}
            hint={`${t('owner.bookings.total')}: ${money(booking.total, booking.currency, i18n.language)} · ${t('owner.bookings.paid')}: ${money(booking.amountPaid, booking.currency, i18n.language)}`}
            inputMode="decimal"
            value={text}
            error={invalid ? t('owner.cash.invalid') : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              {t('owner.cash.back')}
            </Button>
            <Button icon="money" type="submit" loading={submitting}>
              {t('owner.cash.confirm')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
