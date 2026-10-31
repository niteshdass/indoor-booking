import type { Config } from './config';
import { resolveEmail, resolveGoogleClientId, resolveSms } from './admin/settings';
import { createGoogleVerifier } from './auth/google';
import { AppError } from './errors';
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

/**
 * Senders and the Google check read the platform settings at call time, so a change in the admin dashboard
 * applies without a restart (admin values first, then the server env). With nothing configured, development
 * prints messages to the console and production refuses to send.
 */
export function defaultServices(config: Config): AppServices {
  const unconfigured = (channel: 'email' | 'sms') => {
    if (config.nodeEnv === 'production') {
      throw new AppError(503, 'delivery_unconfigured', `${channel === 'email' ? 'Email' : 'SMS'} delivery is not configured`);
    }
  };
  return {
    now: () => new Date(),
    sms: {
      async send(to, text) {
        const sms = await resolveSms(config);
        if (sms) return twilioSmsSender(sms).send(to, text);
        unconfigured('sms');
        console.log(`[sms] to=${to}: ${text}`);
      },
    },
    email: {
      async send(msg) {
        const email = await resolveEmail(config);
        if (email) return smtpEmailSender(email).send(msg);
        unconfigured('email');
        console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      },
    },
    google: createGoogleVerifier(() => resolveGoogleClientId(config)),
    stripe: realStripe,
  };
}
