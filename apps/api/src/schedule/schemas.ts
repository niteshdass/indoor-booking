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
