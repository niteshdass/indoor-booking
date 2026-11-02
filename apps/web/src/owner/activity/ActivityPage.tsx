import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Paged } from '../../components/ui/Pagination';
import { Skeleton } from '../../components/ui/Skeleton';
import { Table } from '../../components/ui/Table';
import { apiGet } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatTime } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import type { ActivityItem, ActivityPage as ActivityData } from '../types';
import { useResource } from '../useResource';
import { activityLabel, changedKeys } from './activityText';
import styles from './activity.module.css';

const LIMIT = 50;
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** Owner activity log (`reports.view`), newest first; fetched 50 at a time, shown a page at a time. */
export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const { ownerId, venues } = useOwner();
  useOwnerTitle(t('owner.activity.title'));
  const first = useResource<ActivityData>(ownerPath(ownerId, `/activity?limit=${LIMIT}`));
  // Pages after the first, and the cursor to the next one (undefined until a page was appended).
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  if (first.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(first.state.error, t)}</p>
        <Button variant="secondary" icon="refresh" onClick={first.reload}>
          {t('owner.activity.retry')}
        </Button>
      </Alert>
    );
  }
  if (first.state.status !== 'ready') return <Skeleton kind="table" label={t('common.loading')} />;

  const items = [...first.state.data.items, ...more];
  const nextBefore = cursor === undefined ? first.state.data.nextBefore : cursor;

  const loadMore = async () => {
    if (nextBefore === null || loading) return false;
    setLoading(true);
    setMoreError(null);
    try {
      const page = await apiGet<ActivityData>(ownerPath(ownerId, `/activity?limit=${LIMIT}&before=${encodeURIComponent(nextBefore)}`));
      setMore((m) => [...m, ...page.items]);
      setCursor(page.nextBefore);
      return page.items.length > 0;
    } catch (e) {
      setMoreError(errorMessage(e, t));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const when = (item: ActivityItem) => {
    // The entry's venue zone when known; entries without a venue (or a venue out of scope) use the browser's.
    const tz = venues.find((v) => v.id === item.venueId)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${formatDate(item.at, tz, i18n.language)} ${formatTime(item.at, tz, i18n.language)}`;
  };

  return (
    <div className={styles.page}>
      {items.length === 0 ? (
        <EmptyState sport="basketball" title={t('owner.activity.empty')} />
      ) : (
        <Paged items={items} more={nextBefore !== null} loading={loading} onMore={loadMore}>
          {(rows) => (
            <Table caption={t('owner.activity.title')}>
              <thead>
                <tr>
                  <th>{t('owner.activity.col.time')}</th>
                  <th>{t('owner.activity.col.actor')}</th>
                  <th>{t('owner.activity.col.action')}</th>
                  <th>{t('owner.activity.col.entity')}</th>
                  <th>{t('owner.activity.col.changes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const keys = changedKeys(item.before, item.after);
                  const hasDetail = item.before !== null || item.after !== null;
                  return (
                    <tr key={item.id}>
                      <td className={styles.num}>{when(item)}</td>
                      <td>{item.actor ? (item.actor.name ?? '—') : t('owner.activity.system')}</td>
                      <td>{activityLabel(item, t)}</td>
                      <td>
                        <span className={styles.stack}>
                          <span>{t(`owner.activity.entity.${item.entity}`, { defaultValue: item.entity })}</span>
                          {item.entity === 'booking' && (
                            <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(item.entityId)}`} className={styles.link} data-row-link>
                              {t('owner.activity.openBooking')}
                            </Link>
                          )}
                        </span>
                      </td>
                      <td>
                        {hasDetail ? (
                          <details>
                            <summary className={styles.summary}>{keys.length > 0 ? keys.join(', ') : t('owner.activity.details')}</summary>
                            <div className={styles.diff}>
                              <span className={styles.diffLabel}>{t('owner.activity.before')}</span>
                              <pre className={styles.pre}>{pretty(item.before)}</pre>
                              <span className={styles.diffLabel}>{t('owner.activity.after')}</span>
                              <pre className={styles.pre}>{pretty(item.after)}</pre>
                            </div>
                          </details>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Paged>
      )}
      {moreError && <Alert tone="danger">{moreError}</Alert>}
    </div>
  );
}
