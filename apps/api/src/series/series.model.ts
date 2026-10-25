import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SERIES_STATUSES, WEEKDAYS, type SeriesClashReason, type SeriesJson, type Weekday } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';
import type { BookingDoc } from '../bookings/booking.model';

const { ObjectId } = mongoose.Schema.Types;

const guestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false },
);

const skippedSchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    reason: { type: String, required: true },
  },
  { _id: false },
);

const seriesSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    turfId: { type: ObjectId, ref: 'Turf', required: true },
    source: { type: String, enum: ['online', 'walkin'], required: true },
    playerId: { type: ObjectId, ref: 'User', default: null },
    guest: { type: guestSchema, default: null },
    createdBy: { type: ObjectId, ref: 'User', default: null },
    weekdays: { type: [{ type: String, enum: WEEKDAYS }], required: true },
    /** 'HH:mm' in the venue's timezone. */
    startTime: { type: String, required: true },
    slotCount: { type: Number, required: true, min: 1 },
    /** 'YYYY-MM-DD' business dates. */
    firstDate: { type: String, required: true },
    endDate: { type: String, default: null },
    count: { type: Number, default: null },
    status: { type: String, enum: SERIES_STATUSES, required: true },
    currency: { type: String, required: true },
    /** Dates left out because they clashed when the series was made. */
    skipped: { type: [skippedSchema], default: [] },
    firstStartAt: { type: Date, required: true },
    lastEndAt: { type: Date, required: true },
    /** Set while requested; the request lapses once it passes. */
    respondBy: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: ObjectId, ref: 'User', default: null },
    declineReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'recurringSeries' },
);
seriesSchema.index({ ownerId: 1, venueId: 1, status: 1, _id: -1 });
seriesSchema.index({ playerId: 1, status: 1 });
// Cross-tenant lifecycle sweeps, paged on (time, _id).
seriesSchema.index({ status: 1, respondBy: 1, _id: 1 });
seriesSchema.index({ status: 1, lastEndAt: 1, _id: 1 });
seriesSchema.plugin(tenantScoped);

export type SeriesDoc = HydratedDocument<InferSchemaType<typeof seriesSchema>>;
export const RecurringSeries = mongoose.model('RecurringSeries', seriesSchema);

export function seriesJson(s: SeriesDoc, games: BookingDoc[], playerName: string | null): SeriesJson {
  return {
    id: String(s.id),
    venueId: String(s.venueId),
    turfId: String(s.turfId),
    status: s.status,
    source: s.source,
    pattern: {
      weekdays: s.weekdays as Weekday[],
      startTime: s.startTime,
      slotCount: s.slotCount,
      firstDate: s.firstDate,
      endDate: s.endDate ?? null,
      count: s.count ?? null,
    },
    currency: s.currency,
    player: s.playerId ? { id: String(s.playerId), name: playerName } : null,
    guest: s.guest ? { name: s.guest.name, phone: s.guest.phone } : null,
    skipped: s.skipped.map((k) => ({ date: k.date, reason: k.reason as SeriesClashReason })),
    respondBy: s.respondBy ? s.respondBy.toISOString() : null,
    declineReason: s.declineReason ?? null,
    createdAt: s.createdAt.toISOString(),
    games: [...games]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .map((g) => ({
        id: String(g.id),
        reference: g.reference,
        businessDate: g.businessDate,
        startAt: g.startAt.toISOString(),
        endAt: g.endAt.toISOString(),
        status: g.status,
        total: g.total,
        amountPaid: g.amountPaid,
      })),
  };
}
