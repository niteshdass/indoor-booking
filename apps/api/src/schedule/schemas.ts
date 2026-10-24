import { z } from 'zod';
import { WEEKDAYS, addDays, assertMinor, isIsoDate, pricingConflict, weekdayOf, type PricingRule } from '@booking/shared';
import { timeSchema } from '../venues/settingsSchema';

export { timeSchema };

/** A real calendar date, YYYY-MM-DD. */
export const isoDateSchema = z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD');

export const minorSchema = z
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
    venueId: z.string().min(1).optional(),
    turfId: z.string().min(1).optional(),
    from: isoDateSchema,
    to: isoDateSchema,
    reason: z.string().trim().max(200).nullish(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.turfId !== undefined && c.venueId === undefined) ctx.addIssue({ code: 'custom', path: ['turfId'], message: 'turfId needs venueId' });
    if (c.to < c.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    } else if ((Date.parse(c.to) - Date.parse(c.from)) / dayMs + 1 > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'A closure spans at most 366 days' });
    }
  });

const recurrenceSchema = z
  .object({
    weekdays: z
      .array(z.enum(WEEKDAYS))
      .min(1)
      .max(7)
      .refine((w) => new Set(w).size === w.length, 'Weekdays must be unique'),
    from: isoDateSchema,
    until: isoDateSchema.optional(),
  })
  .strict()
  .refine((r) => r.until === undefined || r.until >= r.from, { path: ['until'], message: 'until must not be before from' })
  .refine(
    (r) => {
      for (let i = 0; i < 7; i++) {
        const d = addDays(r.from, i);
        if (r.until !== undefined && d > r.until) return false;
        if (r.weekdays.includes(weekdayOf(d))) return true;
      }
      return false;
    },
    { path: ['weekdays'], message: 'No listed weekday falls between from and until' },
  );

/** When an override applies; exactly one of date / recurrence is checked below. */
const when = {
  date: isoDateSchema.optional(),
  recurrence: recurrenceSchema.optional(),
  reason: z.string().trim().max(200).nullish(),
};

export const overrideSchema = z
  .discriminatedUnion('type', [
    z.object({ ...when, type: z.literal('block'), start: timeSchema, end: timeSchema }).strict(),
    z
      .object({ ...when, type: z.literal('modify'), slotStart: timeSchema, start: timeSchema, end: timeSchema, price: minorSchema.optional() })
      .strict(),
    z.object({ ...when, type: z.literal('add'), start: timeSchema, end: timeSchema, price: minorSchema.optional() }).strict(),
    z.object({ ...when, type: z.literal('close') }).strict(),
  ])
  .superRefine((o, ctx) => {
    if ((o.date === undefined) === (o.recurrence === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Give exactly one of date or recurrence' });
    }
  });

export const overrideRangeQuery = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'to must not be before from' });
