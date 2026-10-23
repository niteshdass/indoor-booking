import { z } from 'zod';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mongodbUri: string;
  corsOrigin: string;
  jwtSecret: string;
  googleClientId?: string;
  appUrl: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  APP_URL: z.string().url().default('http://localhost:5173'),
});

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
    appUrl: e.APP_URL,
  };
  if (e.GOOGLE_CLIENT_ID) config.googleClientId = e.GOOGLE_CLIENT_ID;
  return config;
}
