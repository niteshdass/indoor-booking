import type { AppServices, GoogleProfile } from '../../src/services';
import { AppError } from '../../src/errors';

export type TestServices = AppServices & {
  sms: AppServices['sms'] & { sent: { to: string; text: string }[] };
  email: AppServices['email'] & { sent: { to: string; subject: string; text: string }[] };
  google: AppServices['google'] & { register(idToken: string, profile: GoogleProfile): void };
  clock: { advance(ms: number): void };
};

/** Fakes for every external effect; time starts at 2026-01-01T00:00:00Z and only moves via clock.advance. */
export function makeTestServices(): TestServices {
  let nowMs = Date.parse('2026-01-01T00:00:00Z');
  const smsSent: { to: string; text: string }[] = [];
  const emailSent: { to: string; subject: string; text: string }[] = [];
  const googleTokens = new Map<string, GoogleProfile>();
  return {
    now: () => new Date(nowMs),
    clock: {
      advance(ms) {
        nowMs += ms;
      },
    },
    sms: {
      sent: smsSent,
      async send(to, text) {
        smsSent.push({ to, text });
      },
    },
    email: {
      sent: emailSent,
      async send(msg) {
        emailSent.push(msg);
      },
    },
    google: {
      register(idToken, profile) {
        googleTokens.set(idToken, profile);
      },
      async verify(idToken) {
        const p = googleTokens.get(idToken);
        if (!p) throw new AppError(401, 'invalid_google_token', 'Invalid Google token');
        return p;
      },
    },
    otpCode: () => '123456',
  };
}
