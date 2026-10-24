import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AMENITIES } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId, Mixed } = mongoose.Schema.Types;

const venueSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    /** Platform-wide unique; the public page URL. */
    slug: { type: String, required: true },
    address: { type: String, required: true, trim: true, minlength: 1, maxlength: 300 },
    city: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    /** ISO 3166-1 alpha-2. */
    country: { type: String, required: true, match: /^[A-Z]{2}$/ },
    /** ISO 4217; fixed at creation because prices and bookings depend on it. */
    currency: { type: String, required: true },
    /** IANA time zone. */
    timezone: { type: String, required: true },
    /** GeoJSON Point, coordinates [lng, lat]. */
    location: {
      type: { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },
    photos: {
      type: [{ _id: false, url: { type: String, required: true }, alt: { type: String } }],
      default: [],
    },
    amenities: { type: [{ type: String, enum: AMENITIES }], default: [] },
    published: { type: Boolean, default: false },
    /** VenueSettingsOverride: only the keys this venue overrides. */
    settings: { type: Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);
venueSchema.index({ slug: 1 }, { unique: true });
venueSchema.index({ location: '2dsphere' });
venueSchema.index({ ownerId: 1, createdAt: -1 });
venueSchema.plugin(tenantScoped);

export type VenueDoc = HydratedDocument<InferSchemaType<typeof venueSchema>>;
export const Venue = mongoose.model('Venue', venueSchema);
