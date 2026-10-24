import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SPORTS } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const turfSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    sports: { type: [{ type: String, enum: SPORTS }], required: true },
    indoor: { type: Boolean, required: true },
    /** Set at creation only; Plan 05 builds slots from it. */
    slotLengthMin: { type: Number, required: true, min: 30, max: 240 },
    active: { type: Boolean, default: true },
    /** TurfSettingsOverride: hours only. */
    settings: { type: Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);
turfSchema.index(
  { ownerId: 1, venueId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
turfSchema.index({ ownerId: 1, venueId: 1, active: 1 });
turfSchema.plugin(tenantScoped);

export type TurfDoc = HydratedDocument<InferSchemaType<typeof turfSchema>>;
export const Turf = mongoose.model('Turf', turfSchema);
