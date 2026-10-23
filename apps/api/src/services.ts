import type { Config } from './config';
import { createGoogleVerifier } from './auth/google';

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export type GoogleProfile = { sub: string; email?: string; emailVerified: boolean; name?: string };

export interface GoogleVerifier {
  /** Throws AppError(401, 'invalid_google_token') for a bad token. */
  verify(idToken: string): Promise<GoogleProfile>;
}

/** Every external effect and the clock, injected so tests can use fakes. */
export type AppServices = {
  now: () => Date;
  sms: SmsSender;
  email: EmailSender;
  google: GoogleVerifier;
  /** Generates a 6-digit OTP code; defaults to crypto.randomInt. */
  otpCode?: () => string;
};

/** Console senders until real SMS/email providers arrive (Plan 10). */
export function defaultServices(config: Config): AppServices {
  return {
    now: () => new Date(),
    sms: {
      async send(to, text) {
        console.log(`[sms] to=${to}: ${text}`);
      },
    },
    email: {
      async send(msg) {
        console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      },
    },
    google: createGoogleVerifier(config.googleClientId),
  };
}
