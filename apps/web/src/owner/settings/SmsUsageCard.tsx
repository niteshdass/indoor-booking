import { useTranslation } from 'react-i18next';
import type { OwnerSmsUsageJson } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Skeleton } from '../../components/ui/Skeleton';
import { errorMessage } from '../../lib/errors';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useResource } from '../useResource';
import styles from './settings.module.css';

/** Booking SMS: included, or the credit balance and this month's use while the platform meters it. */
export function SmsUsageCard() {
  const { t, i18n } = useTranslation();
  const { ownerId } = useOwner();
  const res = useResource<OwnerSmsUsageJson>(ownerPath(ownerId, '/sms-usage'));
  const title = t('owner.sms.title');
  const n = (v: number) => v.toLocaleString(i18n.language);

  let body;
  if (res.state.status === 'error') body = <Alert tone="danger">{errorMessage(res.state.error, t)}</Alert>;
  else if (res.state.status !== 'ready') body = <Skeleton kind="detail" label={t('common.loading')} />;
  else {
    const u = res.state.data;
    body = (
      <>
        <p className={styles.muted}>{u.metered ? t('owner.sms.metered') : t('owner.sms.included')}</p>
        <dl className={styles.smsFacts}>
          {u.metered && (
            <div>
              <dt>{t('owner.sms.credits')}</dt>
              <dd>{n(u.credits)}</dd>
            </div>
          )}
          <div>
            <dt>{t('owner.sms.messages')}</dt>
            <dd>{n(u.thisMonth.messages)}</dd>
          </div>
          <div>
            <dt>{t('owner.sms.segments')}</dt>
            <dd>{n(u.thisMonth.segments)}</dd>
          </div>
        </dl>
        {u.metered && u.credits === 0 && <Alert tone="warning">{t('owner.sms.empty')}</Alert>}
      </>
    );
  }
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      {body}
    </section>
  );
}
