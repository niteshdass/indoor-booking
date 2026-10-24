import { z } from 'zod';
import { ADDON_PRICING_TYPES } from '@booking/shared';
import { minorSchema, timeSchema } from '../schedule/schemas';

const autoApplySchema = z
  .object({
    range: z.object({ start: timeSchema, end: timeSchema }).strict().optional(),
    outdoorOnly: z.boolean(),
  })
  .strict();

const fields = {
  name: z.string().trim().min(1).max(60),
  pricingType: z.enum(ADDON_PRICING_TYPES),
  price: minorSchema,
  maxQuantity: z.number().int().min(1).max(99),
  stock: z.number().int().min(0).max(9999).nullable(),
  autoApply: autoApplySchema.nullable(),
};

type RuleInput = { pricingType: string; stock?: number | null; autoApply?: unknown };

/** Auto-apply needs a per-booking or per-hour add-on with unlimited stock. */
function addonRules(a: RuleInput, ctx: z.RefinementCtx): void {
  if (a.autoApply == null) return;
  if (a.pricingType === 'per_unit') {
    ctx.addIssue({ code: 'custom', path: ['autoApply'], message: 'Auto-apply is not available for per-unit add-ons' });
  }
  if ((a.stock ?? null) !== null) {
    ctx.addIssue({ code: 'custom', path: ['autoApply'], message: 'Auto-apply needs unlimited stock' });
  }
}

export const addonCreateSchema = z
  .object({ ...fields, maxQuantity: fields.maxQuantity.optional(), stock: fields.stock.optional(), autoApply: fields.autoApply.optional() })
  .strict()
  .superRefine(addonRules);

export const addonPatchSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Provide at least one field');

/** The add-on as it would be stored; patches are merged onto the stored add-on and checked here. */
export const addonMergedSchema = z
  .object({ pricingType: fields.pricingType, stock: fields.stock, autoApply: fields.autoApply })
  .superRefine(addonRules);

export const venueAssignmentSchema = z
  .object({
    enabled: z.boolean(),
    priceOverride: minorSchema.nullable().optional(),
    stock: z.number().int().min(0).max(9999).nullable().optional(),
  })
  .strict();

/** Stock is a venue-level override only. */
export const turfAssignmentSchema = z
  .object({ enabled: z.boolean(), priceOverride: minorSchema.nullable().optional() })
  .strict();
