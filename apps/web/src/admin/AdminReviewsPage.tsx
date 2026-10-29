import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_REVIEW_STATES, type AdminReviewJson, type AdminReviewState } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Stars } from '../components/ui/Stars';
import { Tabs } from '../components/ui/Tabs';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { ActionDialog } from './ActionDialog';
import { useAdminTitle } from './AdminShell';
import { day } from './parts';
import { useCursor } from './useCursor';
import styles from './admin.module.css';

type Pending = { review: AdminReviewJson; action: 'hide' | 'keep' };

/** The flagged-review queue across every business; hide and keep are final. */
export function AdminReviewsPage() {
  const { t, i18n } = useTranslation();
  useAdminTitle(t('admin.nav.reviews'));
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state: AdminReviewState = (ADMIN_REVIEW_STATES as readonly string[]).includes(raw ?? '') ? (raw as AdminReviewState) : 'flagged';
  const list = useCursor<AdminReviewJson>(`/admin/reviews?state=${state}`, 'reviews');
  const [pending, setPending] = useState<Pending | null>(null);

  const settle = async () => {
    if (!pending) return;
    const { review } = await apiPost<{ review: AdminReviewJson }>(`/admin/reviews/${encodeURIComponent(pending.review.id)}/${pending.action}`, {});
    list.replace(review);
    setPending(null);
  };

  const body = () => {
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
    if (list.state.status !== 'ready') return <Skeleton kind="list" label={t('common.loading')} />;
    if (list.rows.length === 0) return <EmptyState sport="tennis" title={t(`admin.reviews.empty.${state}`)} />;
    return (
      <>
        {list.rows.map((r) => (
          <article key={r.id} className={`${styles.panel} ${styles.review}`} aria-label={t('admin.reviews.label', { venue: r.venue.name })}>
            <div className={styles.reviewMeta}>
              <Stars value={r.stars} size="sm" />
              <span>{r.author ?? t('admin.reviews.anonymous')}</span>
              <span>{day(r.createdAt, i18n.language)}</span>
              <Link to={`/venues/${encodeURIComponent(r.venue.slug)}`} className={styles.link}>
                {r.venue.name}
              </Link>
              <Link to={`../owners/${r.owner.id}`} relative="path" className={styles.link}>
                {r.owner.name}
              </Link>
              {r.state !== state && <Badge tone={r.state === 'hidden' ? 'danger' : 'success'}>{t(`admin.reviews.state.${r.state}`)}</Badge>}
            </div>
            {r.comment ? <p className={styles.comment}>{r.comment}</p> : <p className={styles.muted}>{t('admin.reviews.noComment')}</p>}
            {r.flag && (
              <p className={styles.quote}>
                {t('admin.reviews.flagged', { by: r.flag.by ?? t('admin.reviews.anonymous'), date: day(r.flag.at, i18n.language) })}
                {r.flag.reason && ` — ${r.flag.reason}`}
              </p>
            )}
            {r.reply && (
              <p className={`${styles.quote} ${styles.reply}`}>
                {t('admin.reviews.reply')}: {r.reply.text}
              </p>
            )}
            {r.state === 'flagged' && (
              <div className={styles.actions}>
                <Button size="sm" variant="danger" onClick={() => setPending({ review: r, action: 'hide' })}>
                  {t('admin.reviews.hide')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPending({ review: r, action: 'keep' })}>
                  {t('admin.reviews.keep')}
                </Button>
              </div>
            )}
          </article>
        ))}
        {list.moreError && <Alert tone="danger">{list.moreError}</Alert>}
        {list.more && (
          <Button className={styles.more} variant="secondary" loading={list.loading} onClick={() => void list.loadMore()}>
            {t('admin.loadMore')}
          </Button>
        )}
      </>
    );
  };

  const hiding = pending?.action === 'hide';
  return (
    <div className={styles.page}>
      <Tabs
        label={t('admin.reviews.filter')}
        tabs={ADMIN_REVIEW_STATES.map((id) => ({ id, label: t(`admin.reviews.tab.${id}`) }))}
        value={state}
        onChange={(id) => setParams(id === 'flagged' ? {} : { state: id })}
      />
      {body()}
      <ActionDialog
        open={pending !== null}
        title={hiding ? t('admin.reviews.hideTitle') : t('admin.reviews.keepTitle')}
        body={hiding ? t('admin.reviews.hideBody') : t('admin.reviews.keepBody')}
        confirmLabel={hiding ? t('admin.reviews.hide') : t('admin.reviews.keep')}
        tone={hiding ? 'danger' : 'primary'}
        onClose={() => setPending(null)}
        onConfirm={settle}
      />
    </div>
  );
}
