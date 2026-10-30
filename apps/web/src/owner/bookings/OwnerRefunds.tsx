import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { normalizeTrxId } from '@booking/shared';
import { RefundList } from '../../bookings/RefundList';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/TextField';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { PROVIDER_NAMES, formatBdMobile } from '../../lib/wallets';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { RefundJson } from '../types';
import shared from './ReasonDialog.module.css';
import styles from './OwnerRefunds.module.css';

type Kind = 'retry' | 'record-cash';

/** Asks for the TrxID of the money staff sent by hand, then marks the wallet refund sent. */
function MarkSentDialog({ refund, onClose, onSent }: { refund: RefundJson | null; onClose(): void; onSent(): void }) {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const id = refund?.id ?? null;

  useEffect(() => {
    setText('');
    setInvalid(false);
    setError(null);
  }, [id]);

  const submit = async () => {
    if (busy.current || !refund) return;
    const trxId = normalizeTrxId(text);
    if (trxId === null) {
      setInvalid(true);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setInvalid(false);
    setError(null);
    try {
      await apiPost(ownerPath(ownerId, `/refunds/${encodeURIComponent(refund.id)}/mark-sent`), { trxId });
      onSent();
    } catch (e) {
      setError(e);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={refund !== null} onClose={() => !busy.current && onClose()} title={t('owner.refunds.markSentTitle')}>
      {refund && (
        <form
          className={shared.body}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className={shared.description}>{sendLine(refund, t, i18n.language)}</p>
          <TextField
            label={t('owner.refunds.trxId')}
            hint={t('owner.refunds.trxHint')}
            value={text}
            autoCapitalize="characters"
            autoComplete="off"
            error={invalid ? t('owner.refunds.trxInvalid') : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={shared.actions}>
            <Button type="button" variant="secondary" disabled={submitting} onClick={onClose}>
              {t('owner.refunds.back')}
            </Button>
            <Button type="submit" loading={submitting}>
              {t('owner.refunds.markSent')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function sendLine(r: RefundJson, t: TFunction, lang: string): string {
  return t('owner.refunds.sendBack', {
    amount: money(r.amount, r.currency, lang),
    number: formatBdMobile(r.sendTo ?? ''),
    provider: r.provider ? PROVIDER_NAMES[r.provider] : '',
  });
}

/** The refund list plus, for members with refund.issue, the row actions that settle a stuck refund. */
export function OwnerRefunds({ refunds, onChanged }: { refunds: RefundJson[]; onChanged(): void }) {
  const { t, i18n } = useTranslation();
  const { ownerId, can } = useOwner();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState<RefundJson | null>(null);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  const run = async (r: RefundJson, kind: Kind) => {
    if (busy.current) return;
    busy.current = true;
    setBusyId(r.id);
    setError(null);
    try {
      await apiPost(ownerPath(ownerId, `/refunds/${encodeURIComponent(r.id)}/${kind}`), {});
      onChanged();
    } catch (e) {
      setError(e);
      onChanged(); // a 409 or 400 means the row moved on; show its real state
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  };

  const actionable = can('refund.issue') ? refunds.filter((r) => (r.method === 'card' && r.status === 'failed') || (r.method === 'cash' && r.status === 'pending')) : [];

  const toSend = can('payment.verify') ? refunds.filter((r) => r.method === 'wallet' && r.status === 'pending') : [];

  return (
    <>
      <RefundList refunds={refunds} />
      {toSend.length > 0 && (
        <section className={styles.actions} aria-label={t('owner.refunds.walletTitle')}>
          <ul className={styles.list}>
            {toSend.map((r) => (
              <li key={r.id} className={styles.row}>
                <span className={styles.amount}>{sendLine(r, t, i18n.language)}</span>
                <span className={styles.buttons}>
                  <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => setSending(r)}>
                    {t('owner.refunds.markSent')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MarkSentDialog
        refund={sending}
        onClose={() => setSending(null)}
        onSent={() => {
          setSending(null);
          onChanged();
        }}
      />
      {actionable.length > 0 && (
        <section className={styles.actions} aria-label={t('owner.refunds.title')}>
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <ul className={styles.list}>
            {actionable.map((r) => (
              <li key={r.id} className={styles.row}>
                <span className={styles.amount}>{money(r.amount, r.currency, i18n.language)}</span>
                <span className={styles.buttons}>
                  {r.method === 'card' ? (
                    <>
                      <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void run(r, 'retry')}>
                        {t('owner.refunds.retry')}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void run(r, 'record-cash')}>
                        {t('owner.refunds.recordCash')}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busyId !== null} onClick={() => void run(r, 'record-cash')}>
                      {t('owner.refunds.recordPaidOut')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
