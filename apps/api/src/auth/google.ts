import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../errors';
import type { GoogleVerifier } from '../services';

/** `clientId` is read on every check, so a new one saved by an admin applies at once. */
export function createGoogleVerifier(clientId: () => Promise<string | undefined>): GoogleVerifier {
  const client = new OAuth2Client();
  return {
    async verify(idToken) {
      const audience = await clientId();
      if (!audience) {
        throw new AppError(503, 'google_not_configured', 'Google sign-in is not configured');
      }
      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken, audience });
        payload = ticket.getPayload();
      } catch {
        throw new AppError(401, 'invalid_google_token', 'Invalid Google token');
      }
      if (!payload?.sub) throw new AppError(401, 'invalid_google_token', 'Invalid Google token');
      const profile = { sub: payload.sub, emailVerified: payload.email_verified === true } as {
        sub: string;
        email?: string;
        emailVerified: boolean;
        name?: string;
      };
      if (payload.email) profile.email = payload.email;
      if (payload.name) profile.name = payload.name;
      return profile;
    },
  };
}
