import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_PAGE_SIZE, OWNER_STATUSES, type AdminOwnersJson, type OwnerStatus } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { Skeleton } from '../components/ui/Skeleton';
import { Table } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';
import { useAdminTitle } from './AdminShell';
import { day, OwnerStatusBadge, SearchForm } from './parts';
import styles from './admin.module.css';

type Filter = OwnerStatus | 'all';

/** Every business on the platform, by status, searchable by name or contact; filters and page live in the URL. */
export function AdminOwnersPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.owners'));
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status: Filter = raw && (OWNER_STATUSES as readonly string[]).includes(raw) ? (raw as OwnerStatus) : 'all';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (q) query.set('q', q);
  if (page > 1) query.set('page', String(page));
  const { state, reload } = useResource<AdminOwnersJson>(`/admin/owners${query.size ? `?${query}` : ''}`);

  const update = (next: { status?: Filter; q?: string; page?: number }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    const term = next.q ?? q;
    if (s !== 'all') p.set('status', s);
    if (term) p.set('q', term);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    setParams(p);
  };

  const counts = state.status === 'ready' ? state.data.counts : null;
  const n = (v: number) => v.toLocaleString(i18n.language);
  const tabLabel = (id: Filter) => {
    const label = id === 'all' ? t('admin.owners.all') : t(`owner.status.${id}`);
    return counts ? `${label} · ${n(counts[id])}` : label;
  };

  return (
    <div className={styles.page}>
      <Tabs
        label={t('admin.owners.filter')}
        tabs={(['all', ...OWNER_STATUSES] as Filter[]).map((id) => ({ id, label: tabLabel(id) }))}
        value={status}
        onChange={(id) => update({ status: id as Filter })}
      />
      <div className={styles.toolbar}>
        <SearchForm key={q} label={t('admin.owners.search')} value={q} onSearch={(term) => update({ q: term })} />
      </div>
      {state.status === 'error' ? (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(state.error, t)}</p>
          <Button variant="secondary" icon="refresh" onClick={reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      ) : state.status !== 'ready' ? (
        <Skeleton kind="table" label={t('common.loading')} />
      ) : state.data.owners.length === 0 ? (
        <EmptyState sport="football" title={q ? t('admin.owners.noMatch') : t('admin.owners.empty')} />
      ) : (
        <>
          <Table caption={t('admin.nav.owners')}>
            <thead>
              <tr>
                <th>{t('admin.owners.col.business')}</th>
                <th>{t('admin.owners.col.contact')}</th>
                <th>{t('admin.owners.col.status')}</th>
                <th>{t('admin.owners.col.venues')}</th>
                <th>{t('admin.owners.col.bookings')}</th>
                <th>{t('admin.owners.col.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.owners.map((o) => (
                <tr key={o.id}>
                  <td>
                    <span className={styles.stack}>
                      <Link to={o.id} className={styles.link}>
                        {o.name}
                      </Link>
                      <span className={styles.sub}>
                        {o.country} · {o.currency}
                      </span>
                    </span>
                  </td>
                  <td>
                    {o.contact ? (
                      <span className={styles.stack}>
                        <span>{o.contact.name || '—'}</span>
                        <span className={styles.sub}>{o.contact.email ?? o.contact.phone ?? ''}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <OwnerStatusBadge status={o.status} />
                  </td>
                  <td className={styles.num}>{t('admin.owners.venuesValue', { published: n(o.publishedVenues), total: n(o.venues) })}</td>
                  <td className={styles.num}>{n(o.recentBookings)}</td>
                  <td className={styles.num}>{day(o.createdAt, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={state.data.total} onPage={(p) => update({ page: p })} />
        </>
      )}
    </div>
  );
}
