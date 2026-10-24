import { z } from 'zod';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongodbUri: string;
  corsOrigin: string;
  jwtSecret: string;
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
  /** SMTP delivery; unset means emails go to the console. Required in production. */
  email?: { smtpUrl: string; from: string };
  /** Twilio delivery; unset means SMS go to the console. Required in production. */
  sms?: { accountSid: string; authToken: string; from: string };
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
    API_URL: z.string().url().default('http://localhost:4000'),
    PAYMENTS_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of exactly 32 bytes')
      .optional(),
    TRUST_PROXY: z.string().min(1).optional(),
    JOBS_ENABLED: z.enum(['true', 'false']).default('true'),
    SMTP_URL: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM: z.string().min(1).optional(),
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
    // Each provider group is all-or-nothing, and both are required in production.
    const groups = [
      ['SMTP_URL', 'EMAIL_FROM'],
      ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'],
    ] as const;
    for (const keys of groups) {
      const anySet = keys.some((k) => e[k]);
      if (!anySet && e.NODE_ENV !== 'production') continue;
      for (const k of keys) {
        if (!e[k]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: anySet
              ? `is required with ${keys.filter((o) => e[o]).join(', ')}`
              : 'is required in production',
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
    apiUrl: e.API_URL,
    jobsEnabled: e.JOBS_ENABLED === 'true',
  };
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
  if (e.TRUST_PROXY) config.trustProxy = parseTrustProxy(e.TRUST_PROXY);
  return config;
}
