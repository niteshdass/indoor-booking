import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REVIEW_FLAG_REASON_MAX } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Textarea } from '../../components/ui/Textarea';
import { errorMessage } from '../../lib/errors';
import styles from './reviews.module.css';

export type FlagDialogProps = { open: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> };

/** Optional reason, then the flag request. The review stays visible; the platform team checks it. */
export function FlagDialog({ open, onClose, onSubmit }: FlagDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={t('owner.reviews.flagTitle')}>
      <div className={styles.dialogBody}>
        <p className={styles.text}>{t('owner.reviews.flagHint')}</p>
        <Textarea
          label={t('owner.reviews.flagReason')}
          value={reason}
          maxLength={REVIEW_FLAG_REASON_MAX}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
          hint={t('owner.reviews.flagCount', { n: reason.length })}
        />
        {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t('owner.reviews.cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('owner.reviews.flagSubmit')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
