import { z } from 'zod';
import { REVIEW_COMMENT_MAX, REVIEW_FLAG_REASON_MAX, REVIEW_REPLY_MAX } from '@booking/shared';

const starsSchema = z.number().int().min(1).max(5);
/** Trimmed; an empty comment is stored as null. */
const commentSchema = z
  .string()
  .trim()
  .max(REVIEW_COMMENT_MAX)
  .transform((s) => (s === '' ? null : s));

export const reviewBodySchema = z.object({ stars: starsSchema, comment: commentSchema.optional() }).strict();

export const reviewPatchSchema = z
  .object({ stars: starsSchema.optional(), comment: commentSchema.optional() })
  .strict()
  .refine((o) => o.stars !== undefined || o.comment !== undefined, { message: 'Nothing to change' });

export const replyBodySchema = z.object({ text: z.string().trim().min(1).max(REVIEW_REPLY_MAX) }).strict();

export const flagBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(REVIEW_FLAG_REASON_MAX)
      .transform((s) => (s === '' ? null : s))
      .optional(),
  })
  .strict();
