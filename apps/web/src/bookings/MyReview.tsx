import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnReviewJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Stars } from '../components/ui/Stars';
import { apiDelete } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import styles from './MyReview.module.css';
import dialogStyles from './ReviewDialog.module.css';

export type MyReviewProps = {
  review: OwnReviewJson;
  /** `/me/bookings/:id` */
  bookingPath: string;
  onEdit: () => void;
  onDeleted: () => void;
};

/** The player's own review on the booking page. Edit and Delete only show while the edit window is open. */
export function MyReview({ review, bookingPath, onEdit, onDeleted }: MyReviewProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (busy) return;
    setConfirming(false);
    setError(null);
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`${bookingPath}/review`);
      setConfirming(false);
      onDeleted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="my-review-heading">
      <div className={styles.head}>
        <h2 id="my-review-heading" className={styles.heading}>
          {t('reviews.mine')}
        </h2>
        <Stars value={Math.round(review.stars)} size="md" />
        {review.edited && <span className={styles.muted}>{t('reviews.edited')}</span>}
        {review.hidden && <Badge tone="warning">{t('reviews.hidden')}</Badge>}
      </div>
      {review.comment && <p className={styles.comment}>{review.comment}</p>}
      {review.reply && (
        <div className={styles.reply}>
          <span className={styles.replyLabel}>{t('reviews.reply')}</span>
          <p className={styles.comment}>{review.reply.text}</p>
        </div>
      )}
      {review.editableUntil && (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onEdit}>
            {t('reviews.edit')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {t('reviews.delete')}
          </Button>
        </div>
      )}
      <Dialog open={confirming} onClose={close} title={t('reviews.deleteTitle')}>
        <div className={dialogStyles.body}>
          <p className={styles.comment}>{t('reviews.deleteBody')}</p>
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={dialogStyles.actions}>
            <Button variant="secondary" disabled={busy} onClick={close}>
              {t('reviews.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              {t('reviews.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
