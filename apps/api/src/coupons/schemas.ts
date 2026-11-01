import { z } from 'zod';
import { COUPON_CODE_PATTERN, COUPON_TYPES, normalizeCouponCode } from '@booking/shared';
import { minorSchema } from '../schedule/schemas';

const fields = {
  code: z
    .string()
    .transform(normalizeCouponCode)
    .pipe(z.string().regex(COUPON_CODE_PATTERN, 'Use 3 to 24 letters, digits, - or _')),
  type: z.enum(COUPON_TYPES),
  /** A percent (two decimals at most) or minor units; checked against `type` by couponRules. */
  value: z.number().positive().max(1_000_000_000),
  venueIds: z.array(z.string().regex(/^[0-9a-f]{24}$/, 'Invalid venue')).max(200),
  validFrom: z.string().datetime({ offset: true }).nullable(),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable(),
  maxUsesPerCustomer: z.number().int().min(1).max(1000).nullable(),
  minSubtotal: minorSchema,
  maxDiscount: minorSchema.nullable(),
  active: z.boolean(),
};

type RuleInput = {
  type: string;
  value: number;
  validFrom?: string | null;
  validUntil?: string | null;
  maxDiscount?: number | null;
};

/** A percent is 0.01–100 with two decimals; a fixed amount whole minor units; the window runs forward. */
function couponRules(c: RuleInput, ctx: z.RefinementCtx): void {
  if (c.type === 'percent' && (c.value > 100 || Math.abs(Math.round(c.value * 100) - c.value * 100) > 1e-6)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use a percent from 0.01 to 100' });
  }
  if (c.type === 'fixed' && !Number.isSafeInteger(c.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid amount' });
  }
  if (c.type === 'fixed' && (c.maxDiscount ?? null) !== null) {
    ctx.addIssue({ code: 'custom', path: ['maxDiscount'], message: 'A cap is for percent coupons only' });
  }
  if (c.validFrom && c.validUntil && new Date(c.validUntil).getTime() <= new Date(c.validFrom).getTime()) {
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'End after the start' });
  }
}

export const couponCreateSchema = z
  .object({
    ...fields,
    venueIds: fields.venueIds.default([]),
    validFrom: fields.validFrom.default(null),
    validUntil: fields.validUntil.default(null),
    maxUses: fields.maxUses.default(null),
    maxUsesPerCustomer: fields.maxUsesPerCustomer.default(null),
    minSubtotal: fields.minSubtotal.default(0),
    maxDiscount: fields.maxDiscount.default(null),
    active: fields.active.default(true),
  })
  .strict()
  .superRefine(couponRules);

export const couponPatchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Provide at least one field');

/** The coupon as it would be stored; patches are merged onto the stored coupon and checked here. */
export const couponMergedSchema = z
  .object({
    type: fields.type,
    value: fields.value,
    validFrom: fields.validFrom,
    validUntil: fields.validUntil,
    maxDiscount: fields.maxDiscount,
  })
  .superRefine(couponRules);
