import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LOCALES, OWNER_STATUSES } from '@booking/shared';

const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    /** ISO 3166-1 alpha-2. */
    country: { type: String, required: true, match: /^[A-Z]{2}$/ },
    /** ISO 4217. */
    defaultCurrency: { type: String, required: true },
    defaultLocale: { type: String, enum: LOCALES, default: 'en' },
    status: { type: String, enum: OWNER_STATUSES, default: 'active' },
    /** Global defaults; typed by Plan 04. */
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Written by each platform payout submit, so two at once conflict and one retries. */
    payoutLockAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

export type OwnerDoc = HydratedDocument<InferSchemaType<typeof ownerSchema>>;
export const Owner = mongoose.model('Owner', ownerSchema);
