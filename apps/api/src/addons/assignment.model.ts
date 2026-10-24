import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const assignmentSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    addonId: { type: ObjectId, ref: 'Addon', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    /** null = venue-level; a turf-level assignment beats it for that turf. */
    turfId: { type: ObjectId, ref: 'Turf', default: null },
    enabled: { type: Boolean, required: true },
    /** Minor units of the venue's currency; null = use the catalogue price. */
    priceOverride: { type: Number, default: null },
    /** Venue-level only; null = use the catalogue stock. */
    stock: { type: Number, default: null },
  },
  { timestamps: true },
);
assignmentSchema.index({ ownerId: 1, addonId: 1, venueId: 1, turfId: 1 }, { unique: true });
assignmentSchema.index({ ownerId: 1, venueId: 1 });
assignmentSchema.plugin(tenantScoped);

export type AssignmentDoc = HydratedDocument<InferSchemaType<typeof assignmentSchema>>;
export const AddonAssignment = mongoose.model('AddonAssignment', assignmentSchema);

export function assignmentJson(a: {
  id?: unknown;
  addonId: unknown;
  venueId: unknown;
  turfId?: unknown;
  enabled: boolean;
  priceOverride?: number | null;
  stock?: number | null;
}) {
  return {
    id: String(a.id),
    addonId: String(a.addonId),
    venueId: String(a.venueId),
    turfId: a.turfId == null ? null : String(a.turfId),
    enabled: a.enabled,
    priceOverride: a.priceOverride ?? null,
    stock: a.stock ?? null,
  };
}
