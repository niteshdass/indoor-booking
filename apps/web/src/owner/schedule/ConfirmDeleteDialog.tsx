import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { errorMessage } from '../../lib/errors';
import styles from './overrides.module.css';

type Props = { open: boolean; title: string; body: string; confirmLabel: string; onClose(): void; onConfirm(): Promise<void> };

/** Confirm-then-delete dialog; stays open with the translated API error when the delete fails. */
export function ConfirmDeleteDialog({ open, title, body, confirmLabel, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={title}>
      <div className={styles.body}>
        <p className={styles.muted}>{body}</p>
        {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t('owner.venues.cancel')}
          </Button>
          <Button variant="danger" icon="trash" loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
