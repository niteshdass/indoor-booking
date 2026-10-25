import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Textarea } from '../../components/ui/Textarea';
import { errorMessage } from '../../lib/errors';
import styles from './ReasonDialog.module.css';

export const REASON_MAX = 300;

export type ReasonDialogProps = {
  open: boolean;
  title: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  onClose: () => void;
  /** Receives the trimmed reason, or undefined when empty. A rejection keeps the dialog open and shows the error. */
  onSubmit(reason?: string): Promise<void>;
};

/** Confirmation with an optional free-text reason (reject, and later refund notes). */
export function ReasonDialog({ open, title, confirmLabel, tone, onClose, onSubmit }: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      await onSubmit(trimmed ? trimmed : undefined);
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={title}>
      {open && (
        <div className={styles.body}>
          <Textarea
            label={t('owner.bookings.reason.label')}
            hint={`${reason.length} / ${REASON_MAX}`}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              {t('owner.bookings.reason.back')}
            </Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={submitting} onClick={() => void submit()}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
