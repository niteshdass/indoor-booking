import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Textarea } from '../components/ui/Textarea';
import { errorMessage } from '../lib/errors';
import styles from './admin.module.css';

export type ActionDialogProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
  /** Asks for a required reason of at most this many characters. */
  reasonMax?: number;
  onClose(): void;
  /** Receives the trimmed reason when one is asked for. A rejection keeps the dialog open and shows the error. */
  onConfirm(reason?: string): Promise<void>;
};

/** Confirmation for a platform action, with an optional required reason (suspending a business). */
export function ActionDialog({ open, title, body, confirmLabel, tone, reasonMax, onClose, onConfirm }: ActionDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
  }, [open]);

  const trimmed = reason.trim();
  const confirm = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reasonMax === undefined ? undefined : trimmed);
    } catch (e) {
      setError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !running.current && onClose()} title={title}>
      {open && (
        <div className={styles.dialog}>
          <p className={styles.muted}>{body}</p>
          {reasonMax !== undefined && (
            <Textarea
              label={t('admin.reason')}
              hint={`${reason.length} / ${reasonMax}`}
              maxLength={reasonMax}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.dialogActions}>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              {t('admin.cancel')}
            </Button>
            <Button
              variant={tone}
              icon={tone === 'danger' ? 'ban' : 'check'}
              loading={busy}
              disabled={reasonMax !== undefined && trimmed.length === 0}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
