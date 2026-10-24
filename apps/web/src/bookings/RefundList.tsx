import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/Badge';
import { money } from '../lib/format';
import type { RefundJson } from '../lib/types';
import styles from './RefundList.module.css';

/** Refunds created by a cancellation; renders nothing for an empty list. Shared by the detail and lookup pages. */
export function RefundList({ refunds }: { refunds: RefundJson[] }) {
  const { t, i18n } = useTranslation();
  if (refunds.length === 0) return null;
  return (
    <section className={styles.refunds} aria-label={t('cancel.refundsTitle')}>
      <h2 className={styles.refundsTitle}>{t('cancel.refundsTitle')}</h2>
      <ul className={styles.refundList}>
        {refunds.map((r) => (
          <li key={r.id} className={styles.refund}>
            <span className={styles.refundAmount}>{money(r.amount, r.currency, i18n.language)}</span>
            <span>{t(`cancel.method.${r.method}`)}</span>
            <Badge tone={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>
              {t(`cancel.refundStatus.${r.status}`)}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}
