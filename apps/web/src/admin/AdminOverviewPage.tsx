import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_PERIOD_DAYS, type AdminOverviewJson, type AdminOwnerRowJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { StatCard } from '../components/ui/StatCard';
import { moneyCompact, moneyShort } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { useResource } from '../owner/useResource';
import { useAdminTitle } from './AdminShell';
import { day, earnedText, OwnerStatusBadge } from './parts';
import styles from './admin.module.css';

/** "+12% vs previous 30 days", or nothing when there is no previous period to compare with. */
/** Under the Earned KPI: the exact amount when the value is abbreviated, then the other currencies. */
function earnedHint(earned: AdminOverviewJson['earned'], lang: string): string | undefined {
  const [first, ...rest] = earned;
  if (!first) return undefined;
  const exact = moneyShort(first.amount, first.currency, lang);
  const parts = [...(moneyCompact(first.amount, first.currency, lang) === exact ? [] : [exact]), ...(rest.length ? [earnedText(rest, lang)] : [])];
  return parts.length ? parts.join(' · ') : undefined;
}

function trend(recent: number, previous: number, t: TFunction): string | undefined {
  if (previous === 0) return undefined;
  const pct = Math.round(((recent - previous) / previous) * 100);
  return t('admin.overview.trend', { pct: `${pct > 0 ? '+' : ''}${pct}`, days: ADMIN_PERIOD_DAYS });
}

function OwnerList({ owners, empty }: { owners: AdminOwnerRowJson[]; empty: string }) {
  const { t, i18n } = useTranslation();
  if (owners.length === 0) return <p className={styles.muted}>{empty}</p>;
  return (
    <ul className={styles.list}>
      {owners.map((o) => (
        <li key={o.id} className={styles.row}>
          <span className={styles.stack}>
            <Link to={`owners/${o.id}`} className={styles.link}>
              {o.name}
            </Link>
            <span className={styles.sub}>
              {[o.contact?.name || o.contact?.email, o.country, t('admin.owners.applied', { date: day(o.createdAt, i18n.language) })]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <OwnerStatusBadge status={o.status} />
        </li>
      ))}
    </ul>
  );
}

/** Platform health at a glance, plus the businesses waiting for a decision. */
export function AdminOverviewPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.overview'));
  const { state, reload } = useResource<AdminOverviewJson>('/admin/overview');

  if (state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(state.error, t)}</p>
        <Button variant="secondary" onClick={reload}>
          {t('auth.retry')}
        </Button>
      </Alert>
    );
  }
  if (state.status !== 'ready') return <Skeleton kind="dashboard" label={t('common.loading')} />;
  const o = state.data;
  const n = (v: number) => v.toLocaleString(i18n.language);
  const first = o.earned[0];

  return (
    <div className={styles.page}>
      <div className={styles.stats}>
        <StatCard
          label={t('admin.overview.businesses')}
          value={n(o.owners.active)}
          hint={t('admin.overview.businessesHint', { pending: n(o.owners.pending_approval), suspended: n(o.owners.suspended) })}
        />
        <StatCard
          label={t('admin.overview.users')}
          value={n(o.users.total)}
          hint={t('admin.overview.usersHint', { count: o.users.recent, n: n(o.users.recent), days: ADMIN_PERIOD_DAYS })}
        />
        <StatCard
          label={t('admin.overview.venues')}
          value={n(o.venues.published)}
          meter={o.venues.total === 0 ? 0 : o.venues.published / o.venues.total}
          hint={t('admin.overview.venuesHint', { total: n(o.venues.total) })}
        />
        <StatCard
          label={t('admin.overview.bookings', { days: ADMIN_PERIOD_DAYS })}
          value={n(o.bookings.recent)}
          hint={trend(o.bookings.recent, o.bookings.previous, t)}
        />
        <StatCard
          label={t('admin.overview.earned', { days: ADMIN_PERIOD_DAYS })}
          value={first ? moneyCompact(first.amount, first.currency, i18n.language) : '—'}
          hint={earnedHint(o.earned, i18n.language)}
        />
        <StatCard
          label={t('admin.overview.flags')}
          value={n(o.openFlags)}
          tone={o.openFlags > 0 ? 'warning' : undefined}
          hint={o.openFlags > 0 ? t('admin.overview.flagsHint') : undefined}
        />
      </div>

      <div className={styles.split}>
        <section className={styles.panel} aria-labelledby="admin-pending">
          <div className={styles.panelHead}>
            <h2 id="admin-pending" className={styles.heading}>
              {t('admin.overview.pending')}
            </h2>
            <span className={styles.count}>{n(o.owners.pending_approval)}</span>
            {o.owners.pending_approval > 0 && (
              <Link to="owners?status=pending_approval" className={styles.link}>
                {t('admin.overview.seeAll')}
              </Link>
            )}
          </div>
          {o.pendingOwners.length === 0 ? (
            <EmptyState bare size="sm" sport="tennis" title={t('admin.overview.noPending')} />
          ) : (
            <OwnerList owners={o.pendingOwners} empty={t('admin.overview.noPending')} />
          )}
        </section>
        <section className={styles.panel} aria-labelledby="admin-newest">
          <div className={styles.panelHead}>
            <h2 id="admin-newest" className={styles.heading}>
              {t('admin.overview.newest')}
            </h2>
            <Link to="owners" className={styles.link}>
              {t('admin.overview.seeAll')}
            </Link>
          </div>
          <OwnerList owners={o.newestOwners} empty={t('admin.overview.noOwners')} />
        </section>
      </div>
    </div>
  );
}
