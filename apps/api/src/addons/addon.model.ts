import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ADDON_PRICING_TYPES } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const addonSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    pricingType: { type: String, enum: ADDON_PRICING_TYPES, required: true },
    /** Minor units of `currency`. */
    price: { type: Number, required: true, min: 0 },
    /** Copied from the owner's default currency at creation; never changes. */
    currency: { type: String, required: true },
    maxQuantity: { type: Number, default: 10 },
    /** Units available at once; null = unlimited. */
    stock: { type: Number, default: null },
    /** AutoApplyRule | null. */
    autoApply: { type: Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);
addonSchema.index({ ownerId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
addonSchema.plugin(tenantScoped);

export type AddonDoc = HydratedDocument<InferSchemaType<typeof addonSchema>>;
export const Addon = mongoose.model('Addon', addonSchema);

export function addonJson(a: Pick<AddonDoc, 'name' | 'pricingType' | 'price' | 'currency' | 'maxQuantity' | 'stock' | 'autoApply'> & { id?: unknown }) {
  return {
    id: String(a.id),
    name: a.name,
    pricingType: a.pricingType,
    price: a.price,
    currency: a.currency,
    maxQuantity: a.maxQuantity,
    stock: a.stock ?? null,
    autoApply: a.autoApply ?? null,
  };
}
