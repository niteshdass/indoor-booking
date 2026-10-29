import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { PlatformLogJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Paged } from '../components/ui/Pagination';
import { Skeleton } from '../components/ui/Skeleton';
import { Table } from '../components/ui/Table';
import { errorMessage } from '../lib/errors';
import { useAdminTitle } from './AdminShell';
import { dayTime, logLabel } from './parts';
import { useCursor } from './useCursor';
import styles from './admin.module.css';

/** Every platform action, newest first: who approved, suspended, disabled or moderated what. */
export function AdminActivityPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.activity'));
  const list = useCursor<PlatformLogJson>('/admin/activity', 'entries');

  if (list.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(list.state.error, t)}</p>
        <Button variant="secondary" onClick={list.reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (list.state.status !== 'ready') return <Skeleton kind="table" label={t('common.loading')} />;
  if (list.rows.length === 0) return <EmptyState sport="basketball" title={t('admin.activity.empty')} />;

  return (
    <div className={styles.page}>
      <Paged items={list.rows} more={list.more} loading={list.loading} onMore={list.loadMore}>
        {(rows) => (
          <Table caption={t('admin.nav.activity')}>
            <thead>
              <tr>
                <th>{t('admin.activity.col.time')}</th>
                <th>{t('admin.activity.col.actor')}</th>
                <th>{t('admin.activity.col.action')}</th>
                <th>{t('admin.activity.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className={styles.num}>{dayTime(e.at, i18n.language)}</td>
                  <td>{e.actor?.name || '—'}</td>
                  <td>
                    {e.ownerId ? (
                      <Link to={`../owners/${e.ownerId}`} relative="path" className={styles.link}>
                        {logLabel(e, t)}
                      </Link>
                    ) : (
                      logLabel(e, t)
                    )}
                  </td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Paged>
      {list.moreError && <Alert tone="danger">{list.moreError}</Alert>}
    </div>
  );
}
