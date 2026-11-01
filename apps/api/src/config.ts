import { z } from 'zod';
import type { BdSmsProvider } from '@booking/shared';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongodbUri: string;
  corsOrigin: string;
  jwtSecret: string;
  /** Fallback Google client ID; the admin dashboard's setting wins. */
  googleClientId?: string;
  /** Public web app URL, linked from every customer message; required in production. */
  appUrl: string;
  /** Public base URL of this API; builds the webhook URL shown to owners. */
  apiUrl: string;
  /** 32-byte key sealing gateway credentials; required in production. */
  paymentsKey?: Buffer;
  /** Express `trust proxy` value; unset means the socket address is the client. */
  trustProxy?: boolean | number | string;
  /** Whether this process runs the background jobs (sweeps, delivery, refund reconcile). */
  jobsEnabled: boolean;
  /** Bearer secret for `GET /jobs/tick`; the route exists only when it is set. */
  cronSecret?: string;
  /** Sentry project DSN; unexpected errors are reported only when it is set. */
  sentryDsn?: string;
  /** SMTP delivery from the env; the admin dashboard's setting wins. Unset everywhere: console in dev, refused in production. */
  email?: { smtpUrl: string; from: string };
  /** Twilio delivery from the env; the admin dashboard's setting wins. Unset everywhere: console in dev, refused in production. */
  sms?: { accountSid: string; authToken: string; from: string };
  /** A Bangladesh SMS provider from the env, for +8801 numbers; the admin's setting wins. Others still go by Twilio. */
  smsBd?: { provider: BdSmsProvider; apiKey: string; senderId: string };
  /** Public demo deploy: one-click sign-in as the seeded accounts, and settings that would leak or break it are locked. */
  demoMode?: boolean;
  /** Hostnames a production demo may run on; the demo sign-in refuses any other host. */
  demoHosts?: string[];
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    MONGODB_URI: z.string().min(1),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    // Defaulted in loadConfig, so production can tell an unset value apart.
    APP_URL: z.string().url().optional(),
    // Defaulted in loadConfig, so the demo host check only looks at a URL that was really set.
    API_URL: z.string().url().optional(),
    PAYMENTS_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of exactly 32 bytes')
      .optional(),
    TRUST_PROXY: z.string().min(1).optional(),
    JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
    CRON_SECRET: z.string().min(16, 'must be at least 16 characters').optional(),
    SENTRY_DSN: z.string().url().optional(),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    DEMO_HOSTS: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))
      .optional(),
    SMTP_URL: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM: z.string().min(1).optional(),
    SSL_WIRELESS_API_TOKEN: z.string().min(1).optional(),
    SSL_WIRELESS_SID: z.string().min(1).optional(),
    BULKSMSBD_API_KEY: z.string().min(1).optional(),
    BULKSMSBD_SENDER_ID: z.string().min(1).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && !e.PAYMENTS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENTS_ENCRYPTION_KEY'],
        message: 'is required in production',
      });
    }
    if (e.NODE_ENV === 'production' && !e.APP_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['APP_URL'], message: 'is required in production' });
    }
    // Behind a proxy without it, every client shares the proxy's address and so one rate-limit bucket.
    // Set it to false to state there is no proxy.
    if (e.NODE_ENV === 'production' && !e.TRUST_PROXY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRUST_PROXY'], message: 'is required in production' });
    }
    // Demo mode signs anyone in as the seeded admin, so production runs it only on hosts named for it.
    if (e.NODE_ENV === 'production' && e.DEMO_MODE === 'true') {
      if (!e.DEMO_HOSTS?.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEMO_HOSTS'], message: 'is required with DEMO_MODE=true in production' });
      } else {
        for (const key of ['APP_URL', 'API_URL'] as const) {
          const url = e[key];
          if (url && !e.DEMO_HOSTS.includes(new URL(url).hostname.toLowerCase())) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'host is not in DEMO_HOSTS' });
          }
        }
      }
    }
    // Each provider group is all-or-nothing. Both are optional: the admin dashboard can set them instead.
    const groups = [
      ['SMTP_URL', 'EMAIL_FROM'],
      ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
      ['SSL_WIRELESS_API_TOKEN', 'SSL_WIRELESS_SID'],
      ['BULKSMSBD_API_KEY', 'BULKSMSBD_SENDER_ID'],
    ] as const;
    for (const keys of groups) {
      if (!keys.some((k) => e[k])) continue;
      for (const k of keys) {
        if (!e[k]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: `is required with ${keys.filter((o) => e[o]).join(', ')}`,
          });
        }
      }
    }
  });

function parseTrustProxy(raw: string): boolean | number | string {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Treat empty strings as unset so `MONGODB_URI=` fails like a missing key.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const keys = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n  ${keys.join('\n  ')}`);
  }
  const e = result.data;
  const config: Config = {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    mongodbUri: e.MONGODB_URI,
    corsOrigin: e.CORS_ORIGIN,
    jwtSecret: e.JWT_SECRET,
    appUrl: e.APP_URL ?? 'http://localhost:5173',
    apiUrl: e.API_URL ?? 'http://localhost:4000',
    jobsEnabled: e.JOBS_ENABLED === 'true',
  };
  if (e.CRON_SECRET) config.cronSecret = e.CRON_SECRET;
  if (e.SENTRY_DSN) config.sentryDsn = e.SENTRY_DSN;
  if (e.GOOGLE_CLIENT_ID) config.googleClientId = e.GOOGLE_CLIENT_ID;
  if (e.PAYMENTS_ENCRYPTION_KEY) config.paymentsKey = Buffer.from(e.PAYMENTS_ENCRYPTION_KEY, 'base64');
  if (e.SMTP_URL && e.EMAIL_FROM) config.email = { smtpUrl: e.SMTP_URL, from: e.EMAIL_FROM };
  if (e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM) {
    config.sms = {
      accountSid: e.TWILIO_ACCOUNT_SID,
      authToken: e.TWILIO_AUTH_TOKEN,
      from: e.TWILIO_FROM,
    };
  }
  // SSL Wireless first when both are set.
  if (e.SSL_WIRELESS_API_TOKEN && e.SSL_WIRELESS_SID) {
    config.smsBd = { provider: 'ssl_wireless', apiKey: e.SSL_WIRELESS_API_TOKEN, senderId: e.SSL_WIRELESS_SID };
  } else if (e.BULKSMSBD_API_KEY && e.BULKSMSBD_SENDER_ID) {
    config.smsBd = { provider: 'bulksmsbd', apiKey: e.BULKSMSBD_API_KEY, senderId: e.BULKSMSBD_SENDER_ID };
  }
  if (e.TRUST_PROXY) config.trustProxy = parseTrustProxy(e.TRUST_PROXY);
  if (e.DEMO_MODE === 'true') config.demoMode = true;
  if (e.DEMO_HOSTS) config.demoHosts = e.DEMO_HOSTS;
  return config;
}
