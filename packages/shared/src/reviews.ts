export const REVIEW_WINDOW_DAYS = 30;
export const REVIEW_EDIT_DAYS = 30;
export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;
export const REVIEW_FLAG_REASON_MAX = 500;
export const REVIEW_STARS = [1, 2, 3, 4, 5] as const;
export const REVIEW_PAGE_SIZE = 10;

/** Only built when count > 0. */
export type RatingSummary = { average: number; count: number };
export type ReviewReplyJson = { text: string; at: string; editedAt: string | null };
export type PublicReviewJson = {
  id: string;
  stars: number;
  comment: string | null;
  reviewer: string | null;
  createdAt: string;
  edited: boolean;
  reply: ReviewReplyJson | null;
};
export type OwnReviewJson = PublicReviewJson & { hidden: boolean; editableUntil: string | null };
export type OwnerReviewJson = PublicReviewJson & {
  venueId: string;
  bookingId: string;
  reference: string;
  flag: { at: string; reason: string | null } | null;
  /** The platform team kept it after a flag, so it cannot be flagged again. */
  flagCleared: boolean;
  hidden: boolean;
};

/** "Karim Hossain" -> "Karim H."; one word is kept as is; empty -> null. */
export function reviewerName(fullName: string | null | undefined): string | null {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) return words[0]!;
  const last = Array.from(words[words.length - 1]!)[0]!;
  return `${words[0]} ${last.toUpperCase()}.`;
}
