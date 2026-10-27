import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { REVIEW_STARS, type OwnerReviewJson, type RatingSummary } from '@booking/shared';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Dialog } from '../../components/ui/Dialog';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Stars } from '../../components/ui/Stars';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/apiClient';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatRating } from '../../lib/format';
import { useOwner } from '../OwnerProvider';
import { ownerPath } from '../ownerApi';
import { useOwnerTitle } from '../shell/OwnerShell';
import { useResource } from '../useResource';
import { FlagDialog } from './FlagDialog';
import { ReplyForm } from './ReplyForm';
import styles from './reviews.module.css';

type Summary = { venueId: string; name: string; rating: RatingSummary | null };
type Page = { reviews: OwnerReviewJson[]; nextBefore: string | null; summary: Summary[] };
type More = { key: string; items: OwnerReviewJson[]; cursor: string | null };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Owner reviews (`review.manage`): rating per venue, filters kept in the URL, inline reply and flag. */
export function ReviewsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { ownerId, venues, can } = useOwner();
  useOwnerTitle(t('owner.reviews.title'));
  const [params, setParams] = useSearchParams();

  const venueParam = params.get('venue');
  const venueId = venues.some((v) => v.id === venueParam) ? venueParam! : '';
  const starsParam = params.get('stars');
  const stars = REVIEW_STARS.find((s) => String(s) === starsParam);

  const query = (before?: string) => {
    const q = new URLSearchParams();
    if (venueId) q.set('venueId', venueId);
    if (stars) q.set('stars', String(stars));
    if (before) q.set('before', before);
    const s = q.toString();
    return ownerPath(ownerId, `/reviews${s ? `?${s}` : ''}`);
  };
  const key = query();
  const first = useResource<Page>(key);

  // Pages after the first belong to one filter set; edits made here overlay the fetched rows.
  const [more, setMore] = useState<More | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [edits, setEdits] = useState<Record<string, Partial<OwnerReviewJson>>>({});
  const [replying, setReplying] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  // Extra pages belong to one filter set; drop them as soon as the filters change.
  if (more && more.key !== key) setMore(null);

  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const patch = (id: string, over: Partial<OwnerReviewJson>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...over } }));

  if (first.state.status === 'error') {
    return (
      <Alert tone="danger">
        <p className={styles.muted}>{errorMessage(first.state.error, t)}</p>
        <Button variant="secondary" onClick={first.reload}>
          {t('owner.reviews.retry')}
        </Button>
      </Alert>
    );
  }
  if (first.state.status !== 'ready') return <Skeleton kind="list" label={t('common.loading')} />;

  const data = first.state.data;
  const extra = more && more.key === key ? more : null;
  const rows = [...data.reviews, ...(extra?.items ?? [])].map((r) => ({ ...r, ...edits[r.id] }));
  const nextBefore = extra ? extra.cursor : data.nextBefore;
  const venueName = (id: string) => data.summary.find((s) => s.venueId === id)?.name ?? venues.find((v) => v.id === id)?.name ?? '';
  const timeZone = (id: string) => venues.find((v) => v.id === id)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const loadMore = async () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await apiGet<Page>(query(nextBefore));
      setMore((m) => ({ key, items: [...(m && m.key === key ? m.items : []), ...page.reviews], cursor: page.nextBefore }));
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const base = ownerPath(ownerId, '/reviews');
  const saveReply = async (id: string, text: string) => {
    const res = await apiPut<{ review: OwnerReviewJson }>(`${base}/${encodeURIComponent(id)}/reply`, { text });
    patch(id, { reply: res.review.reply });
    setReplying(null);
  };
  const removeReply = async () => {
    if (deleting === null || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await apiDelete(`${base}/${encodeURIComponent(deleting)}/reply`);
      patch(deleting, { reply: null });
      setDeleting(null);
    } catch (err) {
      setDeleteError(err);
    } finally {
      setDeleteBusy(false);
    }
  };
  const flag = async (id: string, reason: string) => {
    const res = await apiPost<{ review: OwnerReviewJson }>(`${base}/${encodeURIComponent(id)}/flag`, reason ? { reason } : {});
    patch(id, { flag: res.review.flag });
    setFlagging(null);
  };

  return (
    <div className={styles.page}>
      <ul className={styles.summary}>
        {data.summary.map((s) => (
          <li key={s.venueId} className={styles.card}>
            <h2 className={styles.cardName}>{s.name}</h2>
            {s.rating ? (
              <div className={styles.rating}>
                <Stars value={round1(s.rating.average)} size="md" />
                <span className={styles.average}>{formatRating(s.rating.average, lang)}</span>
                <span className={styles.muted}>{t('reviews.summaryCount', { count: s.rating.count })}</span>
              </div>
            ) : (
              <p className={styles.muted}>{t('reviews.none')}</p>
            )}
          </li>
        ))}
      </ul>

      <div className={styles.filters}>
        <Select
          label={t('owner.reviews.filterVenue')}
          value={venueId}
          onChange={(e) => setFilter('venue', e.target.value)}
          options={[{ value: '', label: t('owner.reviews.allVenues') }, ...venues.map((v) => ({ value: v.id, label: v.name }))]}
        />
        <Select
          label={t('owner.reviews.filterStars')}
          value={stars ? String(stars) : ''}
          onChange={(e) => setFilter('stars', e.target.value)}
          options={[
            { value: '', label: t('owner.reviews.allStars') },
            ...[...REVIEW_STARS].reverse().map((s) => ({ value: String(s), label: t('reviews.starOption', { count: s }) })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState sport="basketball" title={t('owner.reviews.empty')} />
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id} className={styles.item}>
              <div className={styles.head}>
                <Stars value={r.stars} size="sm" />
                <span className={styles.reviewer}>{r.reviewer ?? t('reviews.player')}</span>
                <span className={styles.muted}>{formatDate(r.createdAt, timeZone(r.venueId), lang)}</span>
                <span className={styles.muted}>{venueName(r.venueId)}</span>
                {can('booking.view') ? (
                  <Link to={`/owner/${encodeURIComponent(ownerId)}/bookings/${encodeURIComponent(r.bookingId)}`} className={styles.link}>
                    {r.reference}
                  </Link>
                ) : (
                  <span className={styles.muted}>{r.reference}</span>
                )}
                {r.edited && <span className={styles.muted}>{t('reviews.edited')}</span>}
                {r.flag && <Badge tone="warning">{t('owner.reviews.flagged')}</Badge>}
                {r.hidden && <Badge tone="neutral">{t('owner.reviews.hidden')}</Badge>}
              </div>
              {r.comment && <p className={styles.text}>{r.comment}</p>}
              {r.reply && replying !== r.id && (
                <div className={styles.reply}>
                  <span className={styles.replyLabel}>{t('reviews.reply')}</span>
                  <p className={styles.text}>{r.reply.text}</p>
                </div>
              )}
              {replying === r.id ? (
                <ReplyForm initial={r.reply?.text ?? ''} onSave={(text) => saveReply(r.id, text)} onCancel={() => setReplying(null)} />
              ) : (
                !r.hidden && (
                  <div className={styles.actions}>
                    {r.reply ? (
                      <>
                        <Button variant="secondary" onClick={() => setReplying(r.id)}>
                          {t('owner.reviews.replyEdit')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(r.id);
                          }}
                        >
                          {t('owner.reviews.replyDelete')}
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => setReplying(r.id)}>
                        {t('owner.reviews.reply')}
                      </Button>
                    )}
                    {!r.flag && !r.flagCleared && (
                      <Button variant="secondary" onClick={() => setFlagging(r.id)}>
                        {t('owner.reviews.flag')}
                      </Button>
                    )}
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {moreError !== null && <Alert tone="danger">{errorMessage(moreError, t)}</Alert>}
      {nextBefore !== null && (
        <Button variant="secondary" className={styles.more} loading={loadingMore} onClick={() => void loadMore()}>
          {t('reviews.showMore')}
        </Button>
      )}

      <FlagDialog open={flagging !== null} onClose={() => setFlagging(null)} onSubmit={(reason) => flag(flagging!, reason)} />
      <Dialog
        open={deleting !== null}
        onClose={() => {
          if (!deleteBusy) setDeleting(null);
        }}
        title={t('owner.reviews.deleteTitle')}
      >
        <div className={styles.dialogBody}>
          <p className={styles.text}>{t('owner.reviews.deleteBody')}</p>
          {deleteError !== null && <Alert tone="danger">{errorMessage(deleteError, t)}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>
              {t('owner.reviews.cancel')}
            </Button>
            <Button variant="danger" loading={deleteBusy} onClick={() => void removeReply()}>
              {t('owner.reviews.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
