import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefundList } from '../../bookings/RefundList';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { apiPost } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import type { RefundJson } from '../types';
import styles from './OwnerRefunds.module.css';

type Kind = 'retry' | 'record-cash';

/** The refund list plus, for members with refund.issue, the row actions that settle a stuck refund. */
export function OwnerRefunds({ refunds, onChanged }: { refunds: RefundJson[]; onChanged(): void }) {
  const { t, i18n } = useTranslation();
  const { ownerId, can } = useOwner();
  const [busyId, setBusyId] = useState<string | null>(null);
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

  return (
    <>
      <RefundList refunds={refunds} />
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
