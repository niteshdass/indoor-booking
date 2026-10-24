import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { overrideAppliesOn, type OverrideRule, type OverrideWhen, type SlotOverrideLike, type Weekday } from '@booking/shared';
import { tenantScoped } from '../tenancy/tenantScoped.plugin';

const { ObjectId } = mongoose.Schema.Types;

const recurrenceSchema = new mongoose.Schema(
  {
    weekdays: { type: [String], required: true },
    /** 'YYYY-MM-DD' business dates; until is inclusive and optional (open-ended). */
    from: { type: String, required: true },
    until: { type: String },
  },
  { _id: false },
);

/**
 * A change to one turf's generated slots on one business date or a weekly recurrence:
 * block { start, end }, modify { slotStart, start, end, price? }, add { start, end, price? } or close.
 */
const slotOverrideSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'Owner', required: true },
    venueId: { type: ObjectId, ref: 'Venue', required: true },
    turfId: { type: ObjectId, ref: 'Turf', required: true },
    date: { type: String },
    recurrence: { type: recurrenceSchema, default: undefined },
    type: { type: String, enum: ['block', 'modify', 'add', 'close'], required: true },
    slotStart: { type: String },
    start: { type: String },
    end: { type: String },
    /** Minor units; beats every pricing rule for the slot. add/modify only. */
    price: { type: Number },
    reason: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true },
);
slotOverrideSchema.index({ ownerId: 1, turfId: 1, date: 1 });
slotOverrideSchema.index({ ownerId: 1, turfId: 1, 'recurrence.from': 1 });
slotOverrideSchema.plugin(tenantScoped);

type SlotOverrideFields = InferSchemaType<typeof slotOverrideSchema>;
export type SlotOverrideDoc = HydratedDocument<SlotOverrideFields>;
export const SlotOverride = mongoose.model('SlotOverride', slotOverrideSchema);

type Stored = Pick<SlotOverrideFields, 'date' | 'recurrence' | 'type' | 'slotStart' | 'start' | 'end' | 'price'>;

export function overrideWhen(o: Stored): OverrideWhen {
  if (o.date) return { date: o.date };
  const r = o.recurrence!;
  return {
    recurrence: { weekdays: [...r.weekdays] as Weekday[], from: r.from, ...(r.until ? { until: r.until } : {}) },
  };
}

export function overrideRule(o: Stored): OverrideRule {
  const price = o.price ?? undefined;
  switch (o.type) {
    case 'block':
      return { type: 'block', start: o.start!, end: o.end! };
    case 'modify':
      return { type: 'modify', slotStart: o.slotStart!, start: o.start!, end: o.end!, ...(price !== undefined ? { price } : {}) };
    case 'add':
      return { type: 'add', start: o.start!, end: o.end!, ...(price !== undefined ? { price } : {}) };
    default:
      return { type: 'close' };
  }
}

export const overrideLike = (o: Stored): SlotOverrideLike => ({ ...overrideWhen(o), ...overrideRule(o) }) as SlotOverrideLike;

export const overrideJson = (o: SlotOverrideDoc) => ({
  id: o.id as string,
  venueId: String(o.venueId),
  turfId: String(o.turfId),
  ...overrideLike(o),
  reason: o.reason ?? null,
});

/** Mongo pre-filter: dated overrides on `from..to` plus recurrences that started by `to`. */
export function overlapsDatesFilter(from: string, to: string): Record<string, unknown> {
  return {
    $or: [
      { date: { $gte: from, $lte: to } },
      { 'recurrence.from': { $lte: to }, $or: [{ 'recurrence.until': { $exists: false } }, { 'recurrence.until': { $gte: from } }] },
    ],
  };
}

/** The turf's overrides applying on this business date, in creation order (computeSlots input). */
export async function overridesFor(
  ownerId: string,
  turfId: string,
  date: string,
): Promise<(OverrideRule & { reason: string | null })[]> {
  const rows = await SlotOverride.find({ ownerId, turfId, ...overlapsDatesFilter(date, date) })
    .sort({ _id: 1 })
    .lean();
  return rows
    .filter((o) => overrideAppliesOn(overrideWhen(o), date))
    .map((o) => ({ ...overrideRule(o), reason: o.reason ?? null }));
}
