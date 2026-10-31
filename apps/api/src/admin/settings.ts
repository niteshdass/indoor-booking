import mongoose from 'mongoose';
import type { Config } from '../config';
import { open } from '../payments/secretBox';

/** The single platform settings document: sign-in and delivery providers an admin sets in the dashboard. */
const platformSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'platform' },
    google: { type: { clientId: { type: String, required: true } }, default: null, _id: false },
    email: {
      type: {
        host: { type: String, required: true },
        port: { type: Number, required: true },
        secure: { type: Boolean, required: true },
        user: { type: String, default: null },
        passwordSealed: { type: String, default: null },
        from: { type: String, required: true },
      },
      default: null,
      _id: false,
    },
    sms: {
      type: {
        accountSid: { type: String, required: true },
        authTokenSealed: { type: String, required: true },
        from: { type: String, required: true },
      },
      default: null,
      _id: false,
    },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { versionKey: false },
);

export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
export type PlatformSettingsDoc = mongoose.InferSchemaType<typeof platformSettingsSchema>;

export const SETTINGS_ID = 'platform';
/** Sealed secrets are bound to their field, so one cannot be swapped for another. */
export const secretAad = (field: 'smtp.password' | 'twilio.authToken') => `platform-settings:${field}`;

/** Every server re-reads within this window after another one saves. */
const CACHE_MS = 15_000;
let cache: { at: number; doc: PlatformSettingsDoc | null } | null = null;

export function clearSettingsCache(): void {
  cache = null;
}

export async function loadSettings(): Promise<PlatformSettingsDoc | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.doc;
  const doc = await PlatformSettings.findById(SETTINGS_ID).lean<PlatformSettingsDoc>();
  cache = { at: Date.now(), doc };
  return doc;
}

export type SmtpSettings = { host: string; port: number; secure: boolean; user: string | null; password: string | null };
export type EmailSettings = { from: string } & ({ url: string } | { smtp: SmtpSettings });
export type SmsSettings = { accountSid: string; authToken: string; from: string };

/** The admin's Google client ID, else the server's. */
export async function resolveGoogleClientId(config: Config): Promise<string | undefined> {
  return (await loadSettings())?.google?.clientId ?? config.googleClientId;
}

/** The admin's SMTP server, else the server's; null means nothing is configured. */
export async function resolveEmail(config: Config): Promise<EmailSettings | null> {
  const e = (await loadSettings())?.email;
  if (e && config.paymentsKey) {
    const password = e.passwordSealed ? open(e.passwordSealed, config.paymentsKey, secretAad('smtp.password')) : null;
    return { from: e.from, smtp: { host: e.host, port: e.port, secure: e.secure, user: e.user ?? null, password } };
  }
  return config.email ? { from: config.email.from, url: config.email.smtpUrl } : null;
}

/** The admin's Twilio account, else the server's; null means nothing is configured. */
export async function resolveSms(config: Config): Promise<SmsSettings | null> {
  const s = (await loadSettings())?.sms;
  if (s && config.paymentsKey) {
    return { accountSid: s.accountSid, from: s.from, authToken: open(s.authTokenSealed, config.paymentsKey, secretAad('twilio.authToken')) };
  }
  return config.sms ?? null;
}
