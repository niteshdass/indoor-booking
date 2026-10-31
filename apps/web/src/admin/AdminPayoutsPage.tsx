import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { STRIPE_PAYOUT_HOLD_MS, SUSPEND_REASON_MAX, type PlatformPayoutJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge, type Tone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Table } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';
import { ApiError, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { money } from '../lib/format';
import { ActionDialog } from './ActionDialog';
import { useAdminTitle } from './AdminShell';
import { day, timeOf } from './parts';
import { useCursor } from './useCursor';
import styles from './admin.module.css';

const FILTERS = ['pending', 'all'] as const;
type Filter = (typeof FILTERS)[number];
type Pending = { payout: PlatformPayoutJson; action: 'confirm' | 'reject' };

/** bKash and Nagad are checked by hand; card payouts are settled by the Stripe webhook only. */
const isManual = (p: PlatformPayoutJson) => p.method !== 'stripe';

/** What the status badge says: a card payout left pending past the hold was never paid and no longer counts. */
type Shown = PlatformPayoutJson['status'] | 'stale';
const shownStatus = (p: PlatformPayoutJson, now: number): Shown =>
  p.status === 'pending' && !isManual(p) && now - Date.parse(p.createdAt) > STRIPE_PAYOUT_HOLD_MS ? 'stale' : p.status;
const TONE: Record<Shown, Tone> = { pending: 'warning', confirmed: 'success', rejected: 'danger', stale: 'neutral' };

/** Owner payouts of the platform fee: the manual queue to confirm or reject, and every payout under All. */
export function AdminPayoutsPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.payouts'));
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('status') === 'all' ? 'all' : 'pending';
  const list = useCursor<PlatformPayoutJson>(`/admin/payouts?status=${filter}`, 'payouts');
  const [pending, setPending] = useState<Pending | null>(null);
  const now = Date.now();
  // A reviewed payout leaves the queue at once; under All it stays with its new status.
  const rows = filter === 'pending' ? list.rows.filter((p) => p.status === 'pending') : list.rows;

  const settle = async (reason?: string) => {
    if (!pending) return;
    let payout: PlatformPayoutJson;
    try {
      ({ payout } = await apiPost<{ payout: PlatformPayoutJson }>(
        `/admin/payouts/${encodeURIComponent(pending.payout.id)}/${pending.action}`,
        pending.action === 'reject' ? { reason } : {},
      ));
    } catch (e) {
      // Another admin got there first: refresh so the row shows what happened; the dialog still shows why.
      if (e instanceof ApiError && e.code === 'payout_not_pending') list.reload();
      throw e;
    }
    list.replace(payout);
    setPending(null);
  };

  const body = () => {
    if (list.state.status === 'error') {
      // A role without platform.owners deep-linked here: retrying won't help.
      if (list.state.error instanceof ApiError && list.state.error.status === 403) {
        return <Alert tone="warning">{t('errors.forbidden')}</Alert>;
      }
      return (
        <Alert tone="danger">
          <p className={styles.muted}>{errorMessage(list.state.error, t)}</p>
          <Button variant="secondary" icon="refresh" onClick={list.reload}>
            {t('auth.retry')}
          </Button>
        </Alert>
      );
    }
    if (list.state.status !== 'ready') return <Skeleton kind="table" label={t('common.loading')} />;
    const more = (
      <>
        {list.moreError && <Alert tone="danger">{list.moreError}</Alert>}
        {list.more && (
          <Button className={styles.more} variant="secondary" icon="chevronDown" loading={list.loading} onClick={() => void list.loadMore()}>
            {t('admin.loadMore')}
          </Button>
        )}
      </>
    );
    // Every loaded row may have been reviewed while older pages remain: say so, and still offer the next page.
    if (rows.length === 0) {
      return (
        <>
          <EmptyState sport="tennis" title={t(`admin.payouts.empty.${filter}`)} />
          {more}
        </>
      );
    }
    return (
      <>
        <Table caption={t('admin.nav.payouts')}>
          <thead>
            <tr>
              <th>{t('admin.payouts.col.business')}</th>
              <th className={styles.end}>{t('admin.payouts.col.amount')}</th>
              <th>{t('admin.payouts.col.method')}</th>
              <th>{t('admin.payouts.col.trxId')}</th>
              <th>{t('admin.payouts.col.date')}</th>
              <th>{t('admin.payouts.col.status')}</th>
              <th>
                <span className={styles.srOnly}>{t('admin.payouts.col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const shown = shownStatus(p, now);
              return (
                <tr key={p.id}>
                  <td>
                    <Link to={`../owners/${p.ownerId}`} relative="path" className={styles.link}>
                      {p.ownerName || '—'}
                    </Link>
                  </td>
                  <td className={`${styles.num} ${styles.end} ${styles.strong}`}>{money(p.amount, p.currency, i18n.language)}</td>
                  <td>
                    <span className={styles.stack}>
                      <span>{t(`admin.payouts.method.${p.method}`)}</span>
                      {p.senderNumber && (
                        <span className={`${styles.sub} ${styles.num}`}>
                          <span className={styles.srOnly}>{t('admin.payouts.col.sender')}: </span>
                          {p.senderNumber}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>{p.trxId ? <span className={`${styles.mono} ${styles.nowrap}`}>{p.trxId}</span> : '—'}</td>
                  <td>
                    <span className={styles.stack}>
                      <span className={styles.num}>{day(p.createdAt, i18n.language)}</span>
                      <span className={`${styles.sub} ${styles.num}`}>{timeOf(p.createdAt, i18n.language)}</span>
                    </span>
                  </td>
                  <td>
                    <span className={styles.stack}>
                      <span>
                        <Badge tone={TONE[shown]} className={styles.nowrap}>{t(`admin.payouts.status.${shown}`)}</Badge>
                      </span>
                      {p.status === 'rejected' && p.rejectReason && <span className={styles.sub}>{p.rejectReason}</span>}
                    </span>
                  </td>
                  <td>
                    {p.status === 'pending' && isManual(p) && (
                      <span className={styles.actions}>
                        <Button size="sm" variant="primary" onClick={() => setPending({ payout: p, action: 'confirm' })}>
                          {t('admin.payouts.confirm')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setPending({ payout: p, action: 'reject' })}>
                          {t('admin.payouts.reject')}
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {more}
      </>
    );
  };

  const target = pending?.payout;
  const vars = target ? { owner: target.ownerName || '—', amount: money(target.amount, target.currency, i18n.language) } : {};
  const rejecting = pending?.action === 'reject';
  return (
    <div className={styles.page}>
      <Tabs
        label={t('admin.payouts.filter')}
        tabs={FILTERS.map((id) => ({ id, label: t(`admin.payouts.tab.${id}`) }))}
        value={filter}
        onChange={(id) => setParams(id === 'pending' ? {} : { status: id })}
      />
      <p className={styles.muted}>{t(`admin.payouts.intro.${filter}`)}</p>
      {body()}
      <ActionDialog
        open={pending !== null}
        title={rejecting ? t('admin.payouts.rejectTitle', vars) : t('admin.payouts.confirmTitle', vars)}
        body={rejecting ? t('admin.payouts.rejectBody') : t('admin.payouts.confirmBody', { trxId: target?.trxId ?? '—' })}
        confirmLabel={rejecting ? t('admin.payouts.reject') : t('admin.payouts.confirm')}
        tone={rejecting ? 'danger' : 'primary'}
        reasonMax={rejecting ? SUSPEND_REASON_MAX : undefined}
        onClose={() => setPending(null)}
        onConfirm={settle}
      />
    </div>
  );
}
