import type { AuthProvidersJson } from '@booking/shared';
import { apiGet } from '../lib/apiClient';

const NONE: AuthProvidersJson = { googleClientId: null, demo: false };
let providers: Promise<AuthProvidersJson> | null = null;

/** The login page's sign-in options, fetched once per page; on failure nothing extra shows and the next mount asks again. */
export function authProviders(): Promise<AuthProvidersJson> {
  providers ??= apiGet<AuthProvidersJson>('/auth/providers').catch(() => {
    providers = null;
    return NONE;
  });
  return providers;
}

/** Tests: forget the cached options. */
export function resetAuthProviders(): void {
  providers = null;
}
