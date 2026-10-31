import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Spinner } from '../../components/ui/Spinner';
import { TextField } from '../../components/ui/TextField';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import type { PaymentLink } from '../types';
import styles from './PaymentLinkDialog.module.css';

type Props = {
  open: boolean;
  link: PaymentLink | null;
  /** Fetches (and starts) the link each time the dialog opens; the parent stores it and passes it back as `link`. */
  load(): Promise<PaymentLink>;
  onClose: () => void;
};

/** A walk-in's payment link as a QR code plus a copyable URL. */
export function PaymentLinkDialog({ open, link, load, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [svg, setSvg] = useState('');
  const [copied, setCopied] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError(null);
    setCopied(false);
    loadRef.current().then(
      () => live && setLoading(false),
      (e) => {
        if (!live) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  const url = link?.url ?? '';
  useEffect(() => {
    if (!url) {
      setSvg('');
      return;
    }
    let live = true;
    // The SVG comes only from the QR library, generated here from the URL string.
    QRCode.toString(url, { type: 'svg' }).then(
      (s) => live && setSvg(s),
      () => live && setSvg(''),
    );
    return () => {
      live = false;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false); // the field is selectable as a fallback
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('owner.link.title')}>
      {open && (
        <div className={styles.body}>
          {loading && <Spinner label={t('common.loading')} />}
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          {error === null && link && (
            <>
              {svg && <div className={styles.qr} role="img" aria-label={t('owner.link.qr')} dangerouslySetInnerHTML={{ __html: svg }} />}
              <p className={styles.amount}>
                {t('owner.link.amount')}: <strong>{money(link.amount, link.currency, i18n.language)}</strong>
              </p>
              <div className={styles.copyRow}>
                <TextField icon="link" className={styles.url} label={t('owner.link.url')} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" icon="link" onClick={() => void copy()}>
                  {t('owner.link.copy')}
                </Button>
              </div>
              <p className={styles.copied} role="status">
                {copied ? t('owner.link.copied') : ''}
              </p>
            </>
          )}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              {t('owner.link.close')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
