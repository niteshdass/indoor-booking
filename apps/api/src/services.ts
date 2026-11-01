import type { Config } from './config';
import { isBdNumber } from '@booking/shared';
import { resolveEmail, resolveGoogleClientId, resolveSms, resolveSmsBd } from './admin/settings';
import { createGoogleVerifier } from './auth/google';
import { AppError } from './errors';
import { bdSmsSender, smtpEmailSender, twilioSmsSender } from './notifications/senders';
import { realSslcommerz, type SslcommerzHttp } from './payments/sslcommerz';
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
  /** HTTP to SSLCommerz; credentials go in each request. */
  sslcommerz: SslcommerzHttp;
};

/**
 * Senders and the Google check read the platform settings at call time, so a change in the admin dashboard
 * applies without a restart (admin values first, then the server env). With nothing configured, development
 * prints messages to the console and production refuses to send.
 */
const unconfigured = (config: Config, channel: 'email' | 'sms') => {
  if (config.nodeEnv === 'production') {
    throw new AppError(503, 'delivery_unconfigured', `${channel === 'email' ? 'Email' : 'SMS'} delivery is not configured`);
  }
};

/** Bangladeshi mobiles go by the Bangladesh provider when one is set; everything else, and they without one, by Twilio. */
export function defaultSmsSender(config: Config, fetchFn?: typeof fetch): SmsSender {
  return {
    async send(to, text) {
      const bd = isBdNumber(to) ? await resolveSmsBd(config) : null;
      if (bd) return bdSmsSender(bd, fetchFn).send(to, text);
      const sms = await resolveSms(config);
      if (sms) return twilioSmsSender(sms, fetchFn).send(to, text);
      unconfigured(config, 'sms');
      console.log(`[sms] to=${to}: ${text}`);
    },
  };
}

export function defaultServices(config: Config): AppServices {
  return {
    now: () => new Date(),
    sms: defaultSmsSender(config),
    email: {
      async send(msg) {
        const email = await resolveEmail(config);
        if (email) return smtpEmailSender(email).send(msg);
        unconfigured(config, 'email');
        console.log(`[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
      },
    },
    google: createGoogleVerifier(() => resolveGoogleClientId(config)),
    stripe: realStripe,
    sslcommerz: realSslcommerz,
  };
}
