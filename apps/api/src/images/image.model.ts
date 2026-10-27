import mongoose, { type InferSchemaType } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** An uploaded photo, already compressed by the browser; served publicly at /images/:id. */
const imageSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
    contentType: { type: String, enum: IMAGE_TYPES, required: true },
    bytes: { type: Number, required: true },
    data: { type: Buffer, required: true },
    /** The venue whose photos list it; null until a venue is saved with it (and swept after a day if never). */
    venueId: { type: ObjectId, ref: 'Venue', default: null },
  },
  { timestamps: true },
);
imageSchema.index({ ownerId: 1, venueId: 1 });
imageSchema.index({ venueId: 1, createdAt: 1 });
imageSchema.plugin(tenantScoped);

export type ImageRecord = InferSchemaType<typeof imageSchema>;
export const Image = mongoose.model('Image', imageSchema);
