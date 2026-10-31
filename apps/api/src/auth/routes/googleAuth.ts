import { Router } from 'express';
import { z } from 'zod';
import type { AuthProvidersJson } from '@booking/shared';
import { resolveGoogleClientId } from '../../admin/settings';
import { AppError } from '../../errors';
import { isDuplicateKeyError } from '../../db';
import type { AuthDeps } from '../deps';
import { normalizeEmail } from '../normalize';
import { issueTokens, sendAuthResponse } from '../tokens';
import { User, assertActive } from '../user.model';

export const googleSchema = z.object({ idToken: z.string().min(1) });

const accountExists = () =>
  new AppError(
    409,
    'account_exists',
    'An account with this email already exists; sign in to it and link Google from your profile',
  );

export function googleAuthRouter({ config, services }: AuthDeps): Router {
  const router = Router();

  router.post('/google', async (req, res) => {
    const profile = await services.google.verify(googleSchema.parse(req.body).idToken);

    let user = await User.findOne({ googleSub: profile.sub });
    let status = 200;
    if (!user) {
      // Only a Google-verified email is stored; it is never used to auto-link an existing account.
      const email = profile.email && profile.emailVerified ? normalizeEmail(profile.email) : undefined;
      if (email && (await User.exists({ email }))) throw accountExists();
      try {
        user = await User.create({
          googleSub: profile.sub,
          name: profile.name ?? '',
          ...(email ? { email, emailVerified: true } : {}),
        });
        status = 201;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        user = await User.findOne({ googleSub: profile.sub });
        if (!user) throw accountExists();
      }
    }
    assertActive(user);
    sendAuthResponse(res, status, user, await issueTokens(user.id, services, config), config);
  });

  return router;
}

/** Which sign-in options the login page can offer; read on every page load, so it sits outside the auth limit. */
export function authProvidersRouter({ config }: AuthDeps): Router {
  const router = Router();
  router.get('/providers', async (_req, res) => {
    const body: AuthProvidersJson = { googleClientId: (await resolveGoogleClientId(config)) ?? null };
    res.json(body);
  });
  return router;
}
