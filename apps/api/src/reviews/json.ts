import {
  REVIEW_EDIT_DAYS,
  reviewerName,
  type OwnerReviewJson,
  type OwnReviewJson,
  type PublicReviewJson,
} from '@booking/shared';
import type { ReviewDoc } from './review.model';

const DAY_MS = 86_400_000;

/** Last moment the author may edit or delete the review (whatever its moderation). */
export const editDeadline = (r: Pick<ReviewDoc, 'createdAt'>): Date =>
  new Date(r.createdAt.getTime() + REVIEW_EDIT_DAYS * DAY_MS);

/** The author may change it while it is visible and `now <= createdAt + REVIEW_EDIT_DAYS`. */
export const isEditable = (r: Pick<ReviewDoc, 'createdAt' | 'moderation'>, now: Date): boolean =>
  r.moderation === 'visible' && now.getTime() <= editDeadline(r).getTime();

/** `authorName` is the author's full user name; only the short public form is served. */
export function publicReviewJson(r: ReviewDoc, authorName: string | null | undefined): PublicReviewJson {
  return {
    id: String(r._id),
    stars: r.stars,
    comment: r.comment ?? null,
    reviewer: reviewerName(authorName),
    createdAt: r.createdAt.toISOString(),
    edited: r.editedAt != null,
    reply: r.reply
      ? {
          text: r.reply.text,
          at: r.reply.at.toISOString(),
          editedAt: r.reply.editedAt ? r.reply.editedAt.toISOString() : null,
        }
      : null,
  };
}

export function ownReviewJson(r: ReviewDoc, authorName: string | null | undefined, now: Date): OwnReviewJson {
  return {
    ...publicReviewJson(r, authorName),
    hidden: r.moderation === 'hidden',
    editableUntil: isEditable(r, now) ? editDeadline(r).toISOString() : null,
  };
}

export function ownerReviewJson(r: ReviewDoc, authorName: string | null | undefined, reference: string): OwnerReviewJson {
  return {
    ...publicReviewJson(r, authorName),
    venueId: String(r.venueId),
    bookingId: String(r.bookingId),
    reference,
    flag: r.flag ? { at: r.flag.at.toISOString(), reason: r.flag.reason ?? null } : null,
    hidden: r.moderation === 'hidden',
  };
}
