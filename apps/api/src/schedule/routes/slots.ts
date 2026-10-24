import { Router } from 'express';
import type { AppServices } from '../../services';
import { AppError } from '../../errors';
import { tenantOf } from '../../tenancy/context';
import { scopedTurf } from '../../venues/guards';
import { inWindow, loadDay, slotJson } from '../load';
import { isoDateSchema } from '../schemas';

export function parseDate(q: unknown): string {
  const parsed = isoDateSchema.safeParse(q);
  if (!parsed.success) {
    throw new AppError(400, 'validation_error', 'Invalid date', parsed.error.flatten());
  }
  return parsed.data;
}

/** Mounted on ownerRouter. */
export function slotsRouter(services: AppServices): Router {
  const router = Router({ mergeParams: true });

  router.get('/venues/:venueId/turfs/:turfId/slots', async (req, res) => {
    const t = tenantOf(req);
    const date = parseDate(req.query.date);
    const { venue, turf } = await scopedTurf(t, req.params.venueId as string, req.params.turfId as string);
    const now = services.now();
    const { day, settings } = await loadDay(t.ownerId, venue, turf, date, now);
    res.json({
      day: {
        businessDate: day.businessDate,
        currency: venue.currency,
        closed: day.closed,
        closedReason: day.closedReason,
        inWindow: inWindow(date, now, venue.timezone, settings.bookingWindowDays),
        slots: day.slots.map(slotJson),
      },
    });
  });

  return router;
}
