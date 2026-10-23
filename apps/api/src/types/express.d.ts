import type { TenantContext } from '../tenancy/context';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: { userId: string };
      /** Set by requireTenant. */
      tenant?: TenantContext;
    }
  }
}
