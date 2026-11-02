import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

/** A venue a player saved to find again. Belongs to the player, not a tenant, so it is not tenant scoped. */
const savedVenueSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
savedVenueSchema.index({ userId: 1, venueId: 1 }, { unique: true });
savedVenueSchema.index({ userId: 1, createdAt: -1 });

export const SavedVenue = mongoose.model('SavedVenue', savedVenueSchema);
