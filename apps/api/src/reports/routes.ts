import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Booking, type BookingDoc } from '../bookings/booking.model';
import { ownerBookingsJson } from '../bookings/ownerJson';
import { Payment } from '../bookings/payment.model';
import type { AppServices } from '../services';
import { requirePermission, tenantOf } from '../tenancy/context';
import { tenantRepo } from '../tenancy/repo';
import { effectiveForTurf } from '../venues/effective';
import { scopedVenue } from '../venues/routes/venues';
import { Turf } from '../venues/turf.model';
import { buildOverview, OVERVIEW_DAYS, overviewRanges, type OverviewBooking, type Range } from './overview';

const RECENT_LIMIT = 6;
const FIELDS = 'turfId playerId guest businessDate status source slots subtotal addonsTotal total amountPaid amountRefunded';

const querySchema = z.object({
  venueId: z.string().regex(/^[0-9a-f]{24}$/i, 'Must be an id'),
  days: z.coerce
    .number()
    .refine((n) => (OVERVIEW_DAYS as readonly number[]).includes(n), `One of ${OVERVIEW_DAYS.join(', ')}`)
    .default(30),
});

const asOverview = (b: BookingDoc): OverviewBooking => ({
  turfId: String(b.turfId),
  businessDate: b.businessDate,
  status: b.status,
  source: b.source,
  slots: b.slots.map((s) => ({ startAt: s.startAt, endAt: s.endAt })),
  subtotal: b.subtotal,
  addonsTotal: b.addonsTotal,
  total: b.total,
  amountPaid: b.amountPaid,
  amountRefunded: b.amountRefunded,
});

/** Mounted on ownerRouter. */
export function reportsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  /** One venue's figures for the last `days` days, each with the period before it. */
  router.get('/reports/overview', requirePermission('reports.view'), async (req, res) => {
    const { venueId, days } = querySchema.parse(req.query);
    const t = tenantOf(req);
    const venue = await scopedVenue(t, venueId);
    const ranges = overviewRanges(days, services.now(), venue.timezone);
    const bookings = tenantRepo(Booking, t, { venueField: 'venueId' });
    const inRange = (r: Range) => bookings.find({ venueId, businessDate: { $gte: r.from, $lte: r.to } }, FIELDS);

    const [current, previous, turfDocs, recent, firstVisits] = await Promise.all([
      inRange(ranges.current),
      inRange(ranges.previous),
      tenantRepo(Turf, t).find({ venueId, active: true }).sort({ name: 1 }),
      bookings.find({ venueId }).sort({ createdAt: -1, _id: -1 }).limit(RECENT_LIMIT),
      // Each customer's first booking at this venue: a registered player by account, a guest by phone.
      Booking.aggregate<{ _id: unknown; first: string }>([
        { $match: { ownerId: new mongoose.Types.ObjectId(t.ownerId), venueId: new mongoose.Types.ObjectId(venueId), status: { $nin: ['awaiting_payment', 'expired', 'rejected'] } } },
        { $group: { _id: { $ifNull: ['$playerId', '$guest.phone'] }, first: { $min: '$businessDate' } } },
        { $match: { _id: { $ne: null }, first: { $gte: ranges.previous.from } } },
      ]),
    ]);
    const turfs = await Promise.all(
      turfDocs.map(async (turf) => ({ id: String(turf.id), name: turf.name, hours: (await effectiveForTurf(t.ownerId, venue, turf)).hours })),
    );

    // What was paid for this period's bookings, by method, net of refunds.
    const payments = await tenantRepo(Payment, t, { venueField: 'venueId' })
      .find({ bookingId: { $in: current.map((b) => b._id) }, status: 'succeeded', excess: false }, 'method amount refundedAmount')
      .lean();
    const methods = new Map<string, { amount: number; count: number }>();
    for (const p of payments) {
      const row = methods.get(p.method) ?? { amount: 0, count: 0 };
      row.amount += p.amount - p.refundedAmount;
      row.count += 1;
      methods.set(p.method, row);
    }

    const within = (r: Range) => firstVisits.filter((v) => v.first >= r.from && v.first <= r.to).length;
    const customers = (list: BookingDoc[]) =>
      new Set(list.filter((b) => b.status !== 'expired' && b.status !== 'awaiting_payment').map((b) => String(b.playerId ?? b.guest?.phone ?? ''))).size;

    const overview = buildOverview({
      current: current.map(asOverview),
      previous: previous.map(asOverview),
      turfs,
      ranges,
      timezone: venue.timezone,
    });
    res.json({
      range: { ...ranges.current, days, previous: ranges.previous },
      currency: venue.currency,
      timezone: venue.timezone,
      ...overview,
      players: {
        value: customers(current),
        previous: customers(previous),
        newValue: within(ranges.current),
        newPrevious: within(ranges.previous),
      },
      methods: [...methods].map(([method, row]) => ({ method, ...row })).sort((a, b) => b.amount - a.amount),
      recent: await ownerBookingsJson(recent),
    });
  });

  return router;
}
