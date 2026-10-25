import { z } from 'zod';
import { MAX_SLOTS_PER_BOOKING, SERIES_MAX_GAMES, WEEKDAYS, type SeriesPattern } from '@booking/shared';
import { nameSchema } from '../auth/routes/emailAuth';
import { isoDateSchema, timeSchema } from '../schedule/schemas';

const patternFields = {
  weekdays: z
    .array(z.enum(WEEKDAYS))
    .min(1)
    .max(WEEKDAYS.length)
    .refine((days) => new Set(days).size === days.length, 'Each weekday once'),
  startTime: timeSchema,
  slotCount: z.number().int().min(1).max(MAX_SLOTS_PER_BOOKING),
  firstDate: isoDateSchema,
  endDate: isoDateSchema.nullish(),
  count: z.number().int().min(1).max(SERIES_MAX_GAMES).nullish(),
};

type PatternInput = { endDate?: string | null; count?: number | null };

/** Exactly one of endDate and count. */
function oneEnd(p: PatternInput, ctx: z.RefinementCtx) {
  const has = (v: unknown) => v !== undefined && v !== null;
  if (has(p.endDate) === has(p.count)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Give exactly one of endDate and count' });
  }
}

const toPattern = <T extends z.infer<z.ZodObject<typeof patternFields>>>(p: T) => ({
  ...p,
  endDate: p.endDate ?? null,
  count: p.count ?? null,
});

/** A weekly pattern; the output is a SeriesPattern with the missing end as null. */
export const seriesPatternSchema = z
  .object(patternFields)
  .strict()
  .superRefine(oneEnd)
  .transform((p): SeriesPattern => toPattern(p));

/** The pattern plus the customer, shaped like the walk-in customer. */
export const ownerSeriesSchema = z
  .object({
    ...patternFields,
    customer: z
      .object({ name: nameSchema, phone: z.string().max(32), playerId: z.string().max(64).optional() })
      .strict(),
  })
  .strict()
  .superRefine(oneEnd)
  .transform((p) => {
    const { customer, ...rest } = toPattern(p);
    return { pattern: rest as SeriesPattern, customer };
  });

export const reasonSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
