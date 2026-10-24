import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Spinner } from '../components/ui/Spinner';
import { ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import type { BookingJson, CancellationPreview, RefundJson } from '../lib/types';
import styles from './CancelDialog.module.css';

export const REASON_MAX = 300;
const FINAL_ERRORS = new Set(['too_late', 'invalid_transition']);

export type CancelDialogProps = {
  open: boolean;
  onClose: () => void;
  loadPreview(): Promise<CancellationPreview>;
  cancel(reason?: string): Promise<{ booking: BookingJson; refunds: RefundJson[] }>;
  onCancelled(b: BookingJson, refunds: RefundJson[]): void;
  /** Extra fields shown above the buttons (the guest flow puts its OTP field here). */
  extra?: ReactNode;
  /** False blocks the confirm button (the guest flow waits for its OTP). */
  canConfirm?: boolean;
};

type Load = { status: 'loading' } | { status: 'ready'; preview: CancellationPreview } | { status: 'error'; error: unknown };

export function CancelDialog({ open, onClose, loadPreview, cancel, onCancelled, extra, canConfirm: allowed = true }: CancelDialogProps) {
  const { t, i18n } = useTranslation();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const busy = useRef(false);
  const reasonId = useId();
  const counterId = `${reasonId}-count`;
  const loader = useRef(loadPreview);
  loader.current = loadPreview;

  useEffect(() => {
    if (!open) {
      setLoad({ status: 'loading' });
      return;
    }
    let live = true;
    setLoad({ status: 'loading' });
    setSubmitError(null);
    setReason('');
    loader.current().then(
      (preview) => live && setLoad({ status: 'ready', preview }),
      (error) => live && setLoad({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [open]);

  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const trimmed = reason.trim();
      const res = await cancel(trimmed ? trimmed : undefined);
      onCancelled(res.booking, res.refunds);
    } catch (error) {
      setSubmitError(error);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : '');
  const canConfirm = load.status === 'ready' && !FINAL_ERRORS.has(errorCode(submitError));

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={t('cancel.title')}>
      {open && (
        <div className={styles.body}>
          {load.status === 'loading' && (
            <div className={styles.loading}>
              <Spinner label={t('common.loading')} />
            </div>
          )}
          {load.status === 'error' && <Alert tone="danger">{errorMessage(load.error, t)}</Alert>}
          {load.status === 'ready' && <PreviewBody preview={load.preview} lang={i18n.language} />}
          {load.status === 'ready' && (
            <>
              <div className={styles.field}>
                <label htmlFor={reasonId} className={styles.label}>
                  {t('cancel.reason')}
                </label>
                <textarea
                  id={reasonId}
                  className={styles.textarea}
                  maxLength={REASON_MAX}
                  value={reason}
                  aria-describedby={counterId}
                  onChange={(e) => setReason(e.target.value)}
                />
                <span id={counterId} className={styles.counter}>
                  {reason.length} / {REASON_MAX}
                </span>
              </div>
              {extra}
            </>
          )}
          {submitError !== null && <Alert tone="danger">{errorMessage(submitError, t)}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              {t('cancel.keep')}
            </Button>
            {canConfirm && (
              <Button variant="danger" loading={submitting} disabled={submitting || !allowed} onClick={() => void confirm()}>
                {t('cancel.confirm')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function PreviewBody({ preview, lang }: { preview: CancellationPreview; lang: string }) {
  const { t } = useTranslation();
  const fmt = (n: number) => money(n, preview.currency, lang);
  const paid = preview.amountPaid - preview.amountRefunded;
  if (paid <= 0) return <p className={styles.note}>{t('cancel.nothingPaid')}</p>;
  return (
    <>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>{t('cancel.paid')}</dt>
          <dd>{fmt(paid)}</dd>
        </div>
        <div className={[styles.row, styles.refund].join(' ')}>
          <dt>{t('cancel.refund', { percent: preview.percent })}</dt>
          <dd>{fmt(preview.amount)}</dd>
        </div>
      </dl>
      <p className={[styles.note, styles.muted].join(' ')}>
        {preview.rule && preview.rule.minHoursBefore !== null
          ? t('cancel.rule', { hours: preview.rule.minHoursBefore, percent: preview.rule.percent })
          : t('cancel.noRule')}
      </p>
      {preview.amount === 0 ? (
        <p className={styles.note}>{t('cancel.noRefund')}</p>
      ) : (
        <>
          {preview.card > 0 && <p className={styles.note}>{t('cancel.toCard', { amount: fmt(preview.card) })}</p>}
          {preview.cash > 0 && <p className={styles.note}>{t('cancel.cashAtVenue', { amount: fmt(preview.cash) })}</p>}
        </>
      )}
    </>
  );
}
