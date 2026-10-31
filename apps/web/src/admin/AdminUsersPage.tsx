import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_PAGE_SIZE, type AdminUserJson, type AdminUsersJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { Skeleton } from '../components/ui/Skeleton';
import { Table } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';
import { ActionDialog } from './ActionDialog';
import { useAdminTitle } from './AdminShell';
import { day, SearchForm } from './parts';
import styles from './admin.module.css';

const FILTERS = ['all', 'active', 'disabled'] as const;
type Filter = (typeof FILTERS)[number];

/** Every account, searchable by name, email or phone; disabling one signs it out everywhere. */
export function AdminUsersPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.users'));
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status: Filter = (FILTERS as readonly string[]).includes(raw ?? '') ? (raw as Filter) : 'all';
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [target, setTarget] = useState<AdminUserJson | null>(null);

  const query = new URLSearchParams();
  if (status !== 'all') query.set('status', status);
  if (q) query.set('q', q);
  if (page > 1) query.set('page', String(page));
  const { state, reload } = useResource<AdminUsersJson>(`/admin/users${query.size ? `?${query}` : ''}`);

  const update = (next: { status?: Filter; q?: string; page?: number }) => {
    const p = new URLSearchParams();
    const s = next.status ?? status;
    const term = next.q ?? q;
    if (s !== 'all') p.set('status', s);
    if (term) p.set('q', term);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    setParams(p);
  };

  const n = (v: number) => v.toLocaleString(i18n.language);
  const disabling = target?.status === 'active';
  const who = target ? target.name || target.email || target.phone || '—' : '';

  const toggle = async () => {
    if (!target) return;
    await apiPost(`/admin/users/${encodeURIComponent(target.id)}/${disabling ? 'disable' : 'enable'}`, {});
    setTarget(null);
    reload();
  };

  return (
    <div className={styles.page}>
      <Tabs
        label={t('admin.users.filter')}
        tabs={FILTERS.map((id) => ({ id, label: t(`admin.users.status.${id}`) }))}
        value={status}
        onChange={(id) => update({ status: id as Filter })}
      />
      <div className={styles.toolbar}>
        <SearchForm key={q} label={t('admin.users.search')} value={q} onSearch={(term) => update({ q: term })} />
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
      ) : state.data.users.length === 0 ? (
        <EmptyState sport="badminton" title={q ? t('admin.users.noMatch') : t('admin.users.empty')} />
      ) : (
        <>
          <Table caption={t('admin.nav.users')}>
            <thead>
              <tr>
                <th>{t('admin.users.col.name')}</th>
                <th>{t('admin.users.col.contact')}</th>
                <th>{t('admin.users.col.teams')}</th>
                <th>{t('admin.users.col.joined')}</th>
                <th>{t('admin.users.col.status')}</th>
                <th>
                  <span className={styles.srOnly}>{t('admin.users.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className={styles.actions}>
                      <span>{u.name || '—'}</span>
                      {u.platformAdmin && <Badge tone="info">{t('admin.users.admin')}</Badge>}
                    </span>
                  </td>
                  <td>
                    <span className={styles.stack}>
                      {u.email && <span>{u.email}</span>}
                      {u.phone && <span className={styles.sub}>{u.phone}</span>}
                      {!u.email && !u.phone && '—'}
                    </span>
                  </td>
                  <td className={styles.num}>{n(u.teams)}</td>
                  <td className={styles.num}>{day(u.createdAt, i18n.language)}</td>
                  <td>
                    <Badge tone={u.status === 'active' ? 'success' : 'danger'}>{t(`admin.users.status.${u.status}`)}</Badge>
                  </td>
                  <td>
                    {!u.platformAdmin && (
                      <Button size="sm" variant={u.status === 'active' ? 'secondary' : 'primary'} icon={u.status === 'active' ? 'ban' : 'power'} onClick={() => setTarget(u)}>
                        {u.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={state.data.total} onPage={(p) => update({ page: p })} />
        </>
      )}
      <ActionDialog
        open={target !== null}
        title={disabling ? t('admin.users.disableTitle', { name: who }) : t('admin.users.enableTitle', { name: who })}
        body={disabling ? t('admin.users.disableBody') : t('admin.users.enableBody')}
        confirmLabel={disabling ? t('admin.users.disable') : t('admin.users.enable')}
        tone={disabling ? 'danger' : 'primary'}
        onClose={() => setTarget(null)}
        onConfirm={toggle}
      />
    </div>
  );
}
