import { Router } from 'express';
import type { AuthDeps } from '../../auth/deps';
import { requireAuth } from '../../auth/requireAuth';
import { requireTenant, tenantOf } from '../context';
import { Owner } from '../owner.model';
import { Role } from '../role.model';
import { activityRouter } from './activity';
import { rolesRouter } from './roles';
import { membersRouter } from './members';
import { settingsRouter } from '../../venues/routes/settings';
import { venuesRouter } from '../../venues/routes/venues';
import { turfsRouter } from '../../venues/routes/turfs';
import { pricingRouter } from '../../schedule/routes/pricing';
import { closuresRouter } from '../../schedule/routes/closures';
import { overridesRouter } from '../../schedule/routes/overrides';
import { slotsRouter } from '../../schedule/routes/slots';
import { catalogueRouter } from '../../addons/routes/catalogue';
import { assignmentsRouter } from '../../addons/routes/assignments';
import { ownerCouponsRouter } from '../../coupons/routes/owner';
import { ownerBookingsRouter } from '../../bookings/routes/owner';
import { ownerSeriesRouter } from '../../series/routes/owner';
import { gatewaysRouter } from '../../payments/routes/gateways';
import { ownerReviewsRouter } from '../../reviews/routes/owner';
import { refundsRouter } from '../../payments/routes/refunds';
import { ownerImagesRouter } from '../../images/routes';
import { reportsRouter } from '../../reports/routes';
import { ownerPayoutsRouter } from '../../platform/routes/ownerPayouts';
import { ownerSmsRouter } from '../../notifications/smsUsage';

/** Everything under /owners/:ownerId; later plans mount their routers on the returned router. */
export function ownerRouter({ config, services }: AuthDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(config, services), requireTenant());

  router.get('/', async (req, res) => {
    const t = tenantOf(req);
    const [owner, role] = await Promise.all([
      Owner.findById(t.ownerId).lean(),
      Role.findOne({ _id: t.roleId, ownerId: { $in: [null, t.ownerId] } }).lean(),
    ]);
    res.json({
      owner: {
        id: t.ownerId,
        name: owner!.name,
        country: owner!.country,
        defaultCurrency: owner!.defaultCurrency,
        defaultLocale: owner!.defaultLocale,
        status: owner!.status,
      },
      membership: {
        id: t.membershipId,
        role: { id: t.roleId, key: t.roleKey, name: role!.name },
        permissions: [...t.permissions].sort(),
        venueIds: t.venueIds,
      },
    });
  });

  router.use(activityRouter());
  router.use(rolesRouter(services));
  router.use(membersRouter(services));
  router.use(settingsRouter(services));
  router.use(ownerImagesRouter(config));
  router.use(venuesRouter(config, services));
  router.use(turfsRouter(services));
  router.use(pricingRouter(services));
  router.use(closuresRouter(services));
  router.use(overridesRouter(services));
  router.use(slotsRouter(services));
  router.use(catalogueRouter(services));
  router.use(assignmentsRouter(services));
  router.use(ownerCouponsRouter(services));
  router.use(ownerBookingsRouter(config, services));
  router.use(ownerSeriesRouter(config, services));
  router.use(gatewaysRouter(config, services));
  router.use(ownerPayoutsRouter(config, services));
  router.use(ownerSmsRouter(services));
  router.use(refundsRouter(config, services));
  router.use(ownerReviewsRouter(services));
  router.use(reportsRouter(services));

  return router;
}
