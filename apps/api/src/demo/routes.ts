import { Router } from 'express';
import { DEMO_ROLES, type DemoRole } from '@booking/shared';
import { AppError } from '../errors';
import type { AuthDeps } from '../auth/deps';
import { issueTokens, sendAuthResponse } from '../auth/tokens';
import { User, assertActive } from '../auth/user.model';
import { DEMO_ACCOUNTS } from './accounts';

const notSeeded = () => new AppError(503, 'demo_not_seeded', 'The demo data is missing; run the seeder');

/** POST /auth/demo/:role signs in as that seeded account without a password. Mounted only when DEMO_MODE=true. */
export function demoAuthRouter({ config, services }: AuthDeps): Router {
  const router = Router();
  router.post('/demo/:role', async (req, res) => {
    // Config already refuses a production demo without DEMO_HOSTS; this keeps a stray host from serving it.
    if (config.nodeEnv === 'production' && !config.demoHosts?.includes(req.hostname.toLowerCase())) {
      throw new AppError(404, 'not_found', 'No such demo account');
    }
    const role = req.params.role as DemoRole;
    if (!DEMO_ROLES.includes(role)) throw new AppError(404, 'not_found', 'No such demo account');
    const user = await User.findOne({ email: DEMO_ACCOUNTS[role] });
    if (!user) throw notSeeded();
    assertActive(user);
    sendAuthResponse(res, 200, user, await issueTokens(user.id, services, config), config);
  });
  return router;
}
