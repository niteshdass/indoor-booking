import type { Config } from './config';
import { createGoogleVerifier } from './auth/google';
import { smtpEmailSender, twilioSmsSender } from './notifications/senders';
import { realStripe, type StripeFactory } from './payments/stripe';

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
  /** Builds a Stripe client for an owner's secret key. */
  stripe: StripeFactory;
};

/** Real SMTP/Twilio senders when configured; console senders otherwise (dev and tests). */
export function defaultServices(config: Config): AppServices {
  return {
    now: () => new Date(),
    sms: config.sms
      ? twilioSmsSender(config.sms)
      : {
          async send(to, text) {
            console.log(`[sms] to=${to}: ${text}`);
          },
        },
    email: config.email
      ? smtpEmailSender({ url: config.email.smtpUrl, from: config.email.from })
      : {
          async send(msg) {
            console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
          },
        },
    google: createGoogleVerifier(config.googleClientId),
    stripe: realStripe,
  };
}
