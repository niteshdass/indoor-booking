import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicReviewJson, RatingSummary } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Stars } from '../components/ui/Stars';
import { apiGet } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import { formatDate, formatRating } from '../lib/format';
import styles from './ReviewsSection.module.css';

type Page = { reviews: PublicReviewJson[]; nextBefore: string | null };

export type ReviewsSectionProps = { slug: string; timeZone: string; rating: RatingSummary | null };

export function ReviewsSection({ slug, timeZone, rating }: ReviewsSectionProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [reviews, setReviews] = useState<PublicReviewJson[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const live = useRef(0);

  const load = useCallback(
    async (before: string | null) => {
      const id = ++live.current;
      setBusy(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        if (before) q.set('before', before);
        const qs = q.toString();
        const page = await apiGet<Page>(`/venues/${encodeURIComponent(slug)}/reviews${qs ? `?${qs}` : ''}`);
        if (id !== live.current) return;
        setReviews((r) => (before ? [...r, ...page.reviews] : page.reviews));
        setNext(page.nextBefore);
        setLoaded(true);
      } catch (err) {
        if (id === live.current) setError(err);
      } finally {
        if (id === live.current) setBusy(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    setReviews([]);
    setNext(null);
    setLoaded(false);
    void load(null);
    return () => {
      live.current++;
    };
  }, [load]);

  return (
    <section id="reviews" className={styles.section} aria-labelledby="venue-reviews-heading">
      <div className={styles.side}>
        <h2 id="venue-reviews-heading" className={styles.heading}>
          {t('reviews.title')}
        </h2>
        {rating && (
          <p className={styles.summary}>
            <span className={styles.average}>{formatRating(rating.average, lang)}</span>
            <span className={styles.summaryMeta}>
              <Stars value={Math.round(rating.average * 10) / 10} size="md" />
              <span className={styles.muted}>{t('reviews.summaryCount', { count: rating.count })}</span>
            </span>
          </p>
        )}
      </div>
      <div className={styles.body}>
        {loaded && reviews.length === 0 && <p className={styles.muted}>{t('reviews.none')}</p>}
        {reviews.length > 0 && (
          <ul className={styles.list}>
            {reviews.map((r) => {
              const who = r.reviewer ?? t('reviews.player');
              return (
                <li key={r.id} className={styles.item}>
                  <span className={styles.avatar} aria-hidden="true">
                    {who.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className={styles.content}>
                    <div className={styles.head}>
                      <span className={styles.reviewer}>{who}</span>
                      <span className={styles.muted}>{formatDate(r.createdAt, timeZone, lang)}</span>
                      {r.edited && <span className={styles.muted}>{t('reviews.edited')}</span>}
                    </div>
                    <Stars value={r.stars} size="sm" />
                    {r.comment && <p className={styles.comment}>{r.comment}</p>}
                    {r.reply && (
                      <div className={styles.reply}>
                        <span className={styles.replyLabel}>{t('reviews.reply')}</span>
                        <p className={styles.comment}>{r.reply.text}</p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
        {(next || (error !== null && !loaded)) && (
          <div>
            <Button variant="secondary" loading={busy} onClick={() => void load(next)}>
              {t('reviews.showMore')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
