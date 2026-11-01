import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { COUPON_TYPES, type CouponJson } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const couponSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    /** Upper case; unique per owner. */
    code: { type: String, required: true },
    type: { type: String, enum: COUPON_TYPES, required: true },
    /** A percent for `percent`, minor units of `currency` for `fixed`. */
    value: { type: Number, required: true, min: 0 },
    /** Copied from the owner's default currency at creation; a fixed coupon only works at venues using it. */
    currency: { type: String, required: true },
    /** Empty: every venue of the owner. */
    venueIds: { type: [ObjectId], default: [] },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    maxUses: { type: Number, default: null },
    maxUsesPerCustomer: { type: Number, default: null },
    /** Minor units. */
    minSubtotal: { type: Number, default: 0, min: 0 },
    /** Minor units; percent coupons only. */
    maxDiscount: { type: Number, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, minimize: false },
);
couponSchema.index({ ownerId: 1, code: 1 }, { unique: true });
couponSchema.plugin(tenantScoped);

export type CouponDoc = HydratedDocument<InferSchemaType<typeof couponSchema>>;
export const Coupon = mongoose.model('Coupon', couponSchema);

export function couponJson(c: CouponDoc, uses: number): CouponJson {
  return {
    id: String(c.id),
    code: c.code,
    type: c.type,
    value: c.value,
    currency: c.currency,
    venueIds: c.venueIds.map(String),
    validFrom: c.validFrom ? c.validFrom.toISOString() : null,
    validUntil: c.validUntil ? c.validUntil.toISOString() : null,
    maxUses: c.maxUses ?? null,
    maxUsesPerCustomer: c.maxUsesPerCustomer ?? null,
    minSubtotal: c.minSubtotal,
    maxDiscount: c.maxDiscount ?? null,
    active: c.active,
    uses,
    createdAt: c.createdAt.toISOString(),
  };
}
