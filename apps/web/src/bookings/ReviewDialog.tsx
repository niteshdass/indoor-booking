import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REVIEW_COMMENT_MAX, type OwnReviewJson } from '@booking/shared';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { StarInput } from '../components/ui/StarInput';
import { Textarea } from '../components/ui/Textarea';
import { apiPatch, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import styles from './ReviewDialog.module.css';

export type ReviewDialogProps = {
  open: boolean;
  onClose: () => void;
  /** `/me/bookings/:id` */
  bookingPath: string;
  /** Set when editing; absent when posting a new review. */
  review?: OwnReviewJson | null;
  onSaved: (review: OwnReviewJson) => void;
};

export function ReviewDialog({ open, onClose, bookingPath, review, onSaved }: ReviewDialogProps) {
  const { t } = useTranslation();
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStars(review?.stars ?? null);
    setComment(review?.comment ?? '');
    setError(null);
  }, [open, review]);

  const submit = async () => {
    if (busy.current || stars === null) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = { stars, comment: comment.trim() };
      const res = review
        ? await apiPatch<{ review: OwnReviewJson }>(`${bookingPath}/review`, body)
        : await apiPost<{ review: OwnReviewJson }>(`${bookingPath}/review`, body);
      onSaved(res.review);
    } catch (err) {
      setError(err);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !busy.current && onClose()} title={review ? t('reviews.editTitle') : t('reviews.dialogTitle')}>
      {open && (
        <div className={styles.body}>
          <StarInput name="review-stars" legend={t('reviews.stars')} value={stars} onChange={setStars} />
          <Textarea
            label={t('reviews.comment')}
            hint={t('reviews.count', { n: comment.length })}
            value={comment}
            maxLength={REVIEW_COMMENT_MAX}
            onChange={(e) => setComment(e.target.value)}
          />
          {error !== null && <Alert tone="danger">{errorMessage(error, t)}</Alert>}
          <div className={styles.actions}>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              {t('reviews.cancel')}
            </Button>
            <Button loading={submitting} disabled={stars === null || submitting} onClick={() => void submit()}>
              {review ? t('reviews.save') : t('reviews.submit')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
