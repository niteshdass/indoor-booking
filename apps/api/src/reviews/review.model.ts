import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const replySchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    by: { type: ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    editedAt: { type: Date, default: null },
  },
  { _id: false },
);

const flagSchema = new mongoose.Schema(
  {
    by: { type: ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    reason: { type: String, default: null },
  },
  { _id: false },
);

const reviewSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    bookingId: { type: ObjectId, ref: 'Booking', required: true },
    playerId: { type: ObjectId, ref: 'User', required: true },
    stars: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: 'stars must be an integer' },
    },
    comment: { type: String, default: null },
    editedAt: { type: Date, default: null },
    reply: { type: replySchema, default: null },
    moderation: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
    flag: { type: flagSchema, default: null },
    /** Set by Plan 18 when an admin keeps a flagged review. */
    flagCleared: { type: Boolean, default: false },
  },
  { timestamps: true },
);
reviewSchema.index({ bookingId: 1 }, { unique: true });
reviewSchema.index({ venueId: 1, moderation: 1, _id: -1 });
reviewSchema.index({ ownerId: 1, venueId: 1, _id: -1 });
reviewSchema.plugin(tenantScoped);

export type ReviewDoc = HydratedDocument<InferSchemaType<typeof reviewSchema>>;
export const Review = mongoose.model('Review', reviewSchema);
