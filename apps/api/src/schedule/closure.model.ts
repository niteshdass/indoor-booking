import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

/** An inclusive date range when the owner (venueId null), a venue (turfId null) or one turf is shut. */
const closureSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', default: null },
    turfId: { type: ObjectId, ref: 'Turf', default: null },
    /** 'YYYY-MM-DD' business dates, inclusive. */
    from: { type: String, required: true },
    to: { type: String, required: true },
    reason: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true },
);
closureSchema.index({ ownerId: 1, venueId: 1, from: 1 });
closureSchema.plugin(tenantScoped);

export type ClosureDoc = HydratedDocument<InferSchemaType<typeof closureSchema>>;
export const Closure = mongoose.model('Closure', closureSchema);

export const closureJson = (c: ClosureDoc) => ({
  id: c.id as string,
  venueId: c.venueId ? String(c.venueId) : null,
  turfId: c.turfId ? String(c.turfId) : null,
  from: c.from,
  to: c.to,
  reason: c.reason ?? null,
});

/** The closure (owner, venue or turf level) covering this business date, if any. */
export async function closureFor(
  ownerId: string,
  venueId: string,
  turfId: string,
  date: string,
): Promise<{ reason: string | null } | null> {
  const hit = await Closure.findOne({
    ownerId,
    from: { $lte: date },
    to: { $gte: date },
    $or: [
      { venueId: null },
      { venueId, turfId: null },
      { venueId, turfId },
    ],
  }).lean();
  return hit ? { reason: hit.reason ?? null } : null;
}
