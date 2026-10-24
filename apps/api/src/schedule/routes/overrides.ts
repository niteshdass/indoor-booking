import { Router } from 'express';
import mongoose from 'mongoose';
import {
  WEEKDAYS,
  addDays,
  generatedRanges,
  overrideAppliesOn,
  overrideDatesIntersect,
  overrideMinutes,
  weekdayOf,
  type OverrideWhen,
  type SlotOverrideLike,
  type Weekday,
  type WeeklyHours,
} from '@booking/shared';
import { AppError } from '../../errors';
import type { AppServices } from '../../services';
import { runInTransaction } from '../../db';
import { logActivity } from '../../tenancy/activityLog.model';
import { requirePermission, tenantOf } from '../../tenancy/context';
import { effectiveForTurf } from '../../venues/effective';
import { lockTurf, scopedTurf } from '../../venues/guards';
import { SlotOverride, overlapsDatesFilter, overrideJson, overrideLike } from '../slotOverride.model';
import { overrideRangeQuery, overrideSchema } from '../schemas';

const overrideNotFound = () => new AppError(404, 'not_found', 'Override not found');
const overlap = () => new AppError(409, 'override_overlap', 'This slot overlaps another slot on this turf');
const slotNotFound = () => new AppError(409, 'slot_not_found', 'No slot starts at that time');

type Extra = Extract<SlotOverrideLike, { type: 'add' | 'modify' }>;

/** Each weekday on which `w` applies on some date, with `w` narrowed to that weekday. */
function byWeekday(w: OverrideWhen): [Weekday, OverrideWhen][] {
  if ('date' in w) return [[weekdayOf(w.date), w]];
  const { from, until } = w.recurrence;
  // A short recurrence (until within a week of from) may never reach some listed weekdays.
  const occurring = new Set<Weekday>();
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (until !== undefined && d > until) break;
    occurring.add(weekdayOf(d));
  }
  return WEEKDAYS.filter((d) => w.recurrence.weekdays.includes(d) && occurring.has(d)).map((d) => [
    d,
    { recurrence: { ...w.recurrence, weekdays: [d] } },
  ]);
}

const intersects = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
const shiftRange = ([s, e]: [number, number], k: number): [number, number] => [s + 1440 * k, e + 1440 * k];
const weekdayPlus = (d: Weekday, k: number) => WEEKDAYS[(WEEKDAYS.indexOf(d) + k + 7) % 7]!;

/** `w` moved by k days: each date it applies on becomes that date + k. */
function shiftWhen(w: OverrideWhen, k: number): OverrideWhen {
  if ('date' in w) return { date: addDays(w.date, k) };
  const { weekdays, from, until } = w.recurrence;
  return {
    recurrence: {
      weekdays: weekdays.map((d) => weekdayPlus(d, k)),
      from: addDays(from, k),
      ...(until !== undefined ? { until: addDays(until, k) } : {}),
    },
  };
}

/**
 * Rejects an add/modify that overlaps a generated slot (other than a modify's own target) or
 * another add/modify, on its own business day or the one before or after (a night session or
 * an extra can run into the next day). Minute ranges on each weekday's business-day timeline;
 * a neighbour day k's ranges shift by 1440·k.
 */
function checkExtra(o: Extra, hours: WeeklyHours, slotLengthMin: number, existing: SlotOverrideLike[]): void {
  const days = byWeekday(o);
  const targetOf = (slotStart: string, day: Weekday) =>
    overrideMinutes({ start: slotStart, end: slotStart }, hours[day])[0];

  if (o.type === 'modify') {
    for (const [day] of days) {
      const target = targetOf(o.slotStart, day);
      if (!generatedRanges(hours[day], slotLengthMin).some(([s]) => s === target)) throw slotNotFound();
    }
  }
  for (const [day, when] of days) {
    const mine = overrideMinutes(o, hours[day]);
    const target = o.type === 'modify' ? targetOf(o.slotStart, day) : null;
    for (const k of [-1, 0, 1]) {
      const kDay = weekdayPlus(day, k);
      const h = hours[kDay];
      const generated = generatedRanges(h, slotLengthMin).filter((g) => k !== 0 || g[0] !== target);
      if (generated.some((g) => intersects(shiftRange(g, k), mine))) throw overlap();
      // Dates of `o` on weekday `day`, moved to the neighbour day being checked.
      const kWhen = shiftWhen(when, k);
      for (const other of existing) {
        if (other.type !== 'add' && other.type !== 'modify') continue;
        if (!overrideDatesIntersect(kWhen, other)) continue;
        if (intersects(mine, shiftRange(overrideMinutes(other, h), k))) throw overlap();
        // Only one modify can replace a given slot.
        if (k === 0 && target !== null && other.type === 'modify' && targetOf(other.slotStart, day) === target) {
          throw overlap();
        }
      }
    }
  }
}

/** Mounted on ownerRouter. */
export function overridesRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });
  const path = '/venues/:venueId/turfs/:turfId/overrides';

  router.get(path, async (req, res) => {
    const t = tenantOf(req);
    const { from, to } = overrideRangeQuery.parse(req.query);
    const { turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const range: OverrideWhen = { recurrence: { weekdays: [...WEEKDAYS], from, until: to } };
    const rows = await SlotOverride.find({ ownerId: t.ownerId, turfId: turf._id, ...overlapsDatesFilter(from, to) }).sort({
      _id: 1,
    });
    const overrides = rows.filter((o) => {
      const like = overrideLike(o);
      return 'date' in like ? overrideAppliesOn(range, like.date) : overrideDatesIntersect(range, like);
    });
    res.json({ overrides: overrides.map(overrideJson) });
  });

  router.post(path, requirePermission('slot.override'), async (req, res) => {
    const t = tenantOf(req);
    const input = overrideSchema.parse(req.body);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const turfId = turf.id as string;
    const { reason, ...rest } = input;
    const like = rest as SlotOverrideLike;
    const { hours } = await effectiveForTurf(t.ownerId, venue, turf);

    const created = await runInTransaction(async (session) => {
      // Lock first so a concurrent create on this turf conflicts (and retries) or sees this one.
      await lockTurf(t, turfId, services.now(), session);
      if (like.type === 'add' || like.type === 'modify') {
        const existing = await SlotOverride.find({ ownerId: t.ownerId, turfId, type: { $in: ['add', 'modify'] } }).session(
          session,
        );
        checkExtra(like, hours, turf.slotLengthMin, existing.map(overrideLike));
      }
      const [doc] = await SlotOverride.create(
        [{ ...like, ownerId: t.ownerId, venueId: venue._id, turfId, reason: reason || null }],
        { session },
      );
      await logActivity(
        t,
        {
          action: 'override.create',
          entity: 'override',
          entityId: doc!.id as string,
          venueId: venue.id as string,
          after: overrideJson(doc!),
        },
        services.now(),
        session,
      );
      return doc!;
    });
    res.status(201).json({ override: overrideJson(created) });
  });

  router.delete(`${path}/:overrideId`, requirePermission('slot.override'), async (req, res) => {
    const t = tenantOf(req);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const id = req.params.overrideId as string;
    const override = mongoose.isValidObjectId(id)
      ? await SlotOverride.findOne({ ownerId: t.ownerId, turfId: turf._id, _id: id })
      : null;
    if (!override) throw overrideNotFound();
    await runInTransaction(async (session) => {
      const { deletedCount } = await SlotOverride.deleteOne({ ownerId: t.ownerId, _id: override._id }, { session });
      if (deletedCount !== 1) throw overrideNotFound();
      await logActivity(
        t,
        {
          action: 'override.delete',
          entity: 'override',
          entityId: override.id as string,
          venueId: venue.id as string,
          before: overrideJson(override),
        },
        services.now(),
        session,
      );
    });
    res.status(204).end();
  });

  return router;
}
