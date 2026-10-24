import { z } from 'zod';
import { assertMinor, isIsoDate, pricingConflict, type PricingRule } from '@booking/shared';
import { timeSchema } from '../venues/settingsSchema';

export { timeSchema };

/** A real calendar date, YYYY-MM-DD. */
export const isoDateSchema = z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD');

const minorSchema = z
  .number()
  .int()
  .min(0)
  .refine((n) => {
    try {
      assertMinor(n);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid amount');

/** end <= start ends the next day. */
const rangeSchema = z.object({ start: timeSchema, end: timeSchema }).strict();

const rule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: isoDateSchema, range: rangeSchema.optional(), price: minorSchema }).strict(),
  z.object({ kind: z.literal('weekend'), range: rangeSchema.optional(), price: minorSchema }).strict(),
  z.object({ kind: z.literal('weekday'), range: rangeSchema.optional(), price: minorSchema }).strict(),
]);

export const pricingSchema = z
  .object({ base: minorSchema, rules: z.array(rule).max(100) })
  .strict()
  .superRefine((p, ctx) => {
    const clash = pricingConflict(p.rules as PricingRule[]);
    if (clash) ctx.addIssue({ code: 'custom', path: ['rules'], message: `Rules ${clash[0]} and ${clash[1]} overlap` });
  });

const dayMs = 86_400_000;

export const closureSchema = z
  .object({
    venueId: z.string().optional(),
    turfId: z.string().optional(),
    from: isoDateSchema,
    to: isoDateSchema,
    reason: z.string().trim().max(200).nullish(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.turfId && !c.venueId) ctx.addIssue({ code: 'custom', path: ['turfId'], message: 'turfId needs venueId' });
    if (c.to < c.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    } else if ((Date.parse(c.to) - Date.parse(c.from)) / dayMs + 1 > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'A closure spans at most 366 days' });
    }
  });
