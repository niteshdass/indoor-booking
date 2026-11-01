import mongoose from 'mongoose';
import { BD_SMS_PROVIDERS, DEFAULT_PLATFORM_FEE, FEE_PAYERS, OWNER_APPROVAL_MODES, PLATFORM_FEE_MODES, SPORTS, WALLET_PROVIDERS, mergeSportSettings } from '@booking/shared';
import type { BdSmsProvider, ManualWallet, OwnerApprovalMode, PlatformFeeSettings, Sport, SportSetting } from '@booking/shared';
import type { Config } from '../config';
import type { GatewayCredentials } from '../payments/gateway';
import { open } from '../payments/secretBox';

const walletSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: WALLET_PROVIDERS, required: true },
    number: { type: String, required: true },
    accountType: { type: String, enum: ['personal', 'merchant', 'agent'], required: true },
    note: { type: String },
  },
  { _id: false },
);

/** One mode's payout Stripe keys; the secret key and webhook secret are sealed together. */
const payoutKeySetSchema = new mongoose.Schema(
  {
    credentialsEncrypted: { type: String, required: true },
    publishableKey: { type: String, required: true },
    accountId: { type: String, required: true },
  },
  { _id: false },
);

const feeSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: PLATFORM_FEE_MODES, required: true },
    fixed: { type: Number, default: null },
    percent: { type: Number, default: null },
    payer: { type: String, enum: FEE_PAYERS, required: true },
  },
  { _id: false },
);

const generalSchema = new mongoose.Schema(
  {
    ownerApproval: { type: String, enum: OWNER_APPROVAL_MODES, required: true },
    fee: { type: feeSchema, required: true },
    payout: {
      bkash: { type: walletSchema, default: null },
      nagad: { type: walletSchema, default: null },
      stripe: {
        type: new mongoose.Schema(
          {
            mode: { type: String, enum: ['test', 'live'], required: true },
            enabled: { type: Boolean, required: true },
            keys: {
              test: { type: payoutKeySetSchema, default: null },
              live: { type: payoutKeySetSchema, default: null },
            },
          },
          { _id: false },
        ),
        default: null,
      },
    },
  },
  { _id: false },
);

const sportSettingSchema = new mongoose.Schema(
  {
    sport: { type: String, enum: SPORTS, required: true },
    enabled: { type: Boolean, required: true },
  },
  { _id: false },
);

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
    /** A Bangladesh provider for +8801 numbers; others still go by Twilio. */
    smsBd: {
      type: {
        provider: { type: String, enum: BD_SMS_PROVIDERS, required: true },
        apiKeySealed: { type: String, required: true },
        senderId: { type: String, required: true },
      },
      default: null,
      _id: false,
    },
    /** When on, each owner's booking SMS is charged against its credits; OTPs never are. */
    smsMetered: { type: Boolean, default: false },
    general: { type: generalSchema, default: null },
    /** The sport catalog's order and switches; null until an admin saves it. */
    sports: { type: [sportSettingSchema], default: null },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { versionKey: false },
);

export const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
export type PlatformSettingsDoc = mongoose.InferSchemaType<typeof platformSettingsSchema>;

export const SETTINGS_ID = 'platform';
/** Sealed secrets are bound to their field, so one cannot be swapped for another. */
export const secretAad = (field: 'smtp.password' | 'twilio.authToken' | 'smsBd.apiKey' | 'payout.stripe') => `platform-settings:${field}`;

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
export type SmsBdSettings = { provider: BdSmsProvider; apiKey: string; senderId: string };

/** The sport catalog with the admin's order and switches. */
export async function resolveSportSettings(): Promise<SportSetting[]> {
  return mergeSportSettings((await loadSettings())?.sports);
}

/** Sports players and owners can pick right now, in the admin's order. */
export async function enabledSports(): Promise<Sport[]> {
  return (await resolveSportSettings()).filter((s) => s.enabled).map((s) => s.sport);
}

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

/** The admin's Bangladesh provider, else the server's; null means +8801 numbers go by Twilio too. */
export async function resolveSmsBd(config: Config): Promise<SmsBdSettings | null> {
  const s = (await loadSettings())?.smsBd;
  if (s && config.paymentsKey) {
    return { provider: s.provider as BdSmsProvider, senderId: s.senderId, apiKey: open(s.apiKeySealed, config.paymentsKey, secretAad('smsBd.apiKey')) };
  }
  return config.smsBd ?? null;
}

/** Whether owners' SMS is charged against their credits right now. */
export async function smsMetered(): Promise<boolean> {
  return (await loadSettings())?.smsMetered === true;
}

/** A saved wallet as the API shapes it: no `note` key when there is none. */
export function walletOf(w: { provider: string; number: string; accountType: string; note?: string | null } | null | undefined): ManualWallet | null {
  if (!w) return null;
  return { provider: w.provider, number: w.number, accountType: w.accountType, ...(w.note ? { note: w.note } : {}) } as ManualWallet;
}

/** The admin's payout Stripe account as everyone may see it: no secrets. */
export type PayoutStripe = { mode: 'test' | 'live'; publishableKey: string; accountId: string };
export type GeneralSettings = {
  ownerApproval: OwnerApprovalMode;
  fee: PlatformFeeSettings;
  payout: { bkash: ManualWallet | null; nagad: ManualWallet | null; stripe: PayoutStripe | null };
};

/**
 * Every saved mode's payout Stripe credentials, enabled or not, for verifying the platform webhook: test and
 * live deliveries share the URL, and a payout started before Stripe was switched off can still settle.
 */
export async function payoutStripeWebhookCreds(config: Config): Promise<GatewayCredentials[]> {
  const keys = (await loadSettings())?.general?.payout?.stripe?.keys;
  const key = config.paymentsKey;
  if (!keys || !key) return [];
  return [keys.test, keys.live]
    .filter((set) => !!set)
    .map((set) => JSON.parse(open(set.credentialsEncrypted, key, secretAad('payout.stripe'))) as GatewayCredentials);
}

/** Approval mode, platform fee and where owners pay it; defaults when nothing is saved. Opens no secrets. */
export async function resolveGeneral(config: Config): Promise<GeneralSettings> {
  const g = (await loadSettings())?.general;
  let stripe: PayoutStripe | null = null;
  const s = g?.payout?.stripe;
  const set = s?.keys?.[s.mode];
  if (s && s.enabled && set && config.paymentsKey) {
    stripe = { mode: s.mode, publishableKey: set.publishableKey, accountId: set.accountId };
  }
  return {
    ownerApproval: g?.ownerApproval ?? 'manual',
    fee: g ? { mode: g.fee.mode, fixed: g.fee.fixed ?? null, percent: g.fee.percent ?? null, payer: g.fee.payer } : { ...DEFAULT_PLATFORM_FEE },
    payout: { bkash: walletOf(g?.payout?.bkash), nagad: walletOf(g?.payout?.nagad), stripe },
  };
}

/** The active payout Stripe account with its secret credentials; null when off, unsealable or unreadable. */
export async function resolvePayoutStripe(config: Config): Promise<(PayoutStripe & { creds: GatewayCredentials }) | null> {
  const stripe = (await resolveGeneral(config)).payout.stripe;
  const s = (await loadSettings())?.general?.payout?.stripe;
  const set = s?.keys?.[s.mode];
  if (!stripe || !set || !config.paymentsKey) return null;
  try {
    const creds = JSON.parse(open(set.credentialsEncrypted, config.paymentsKey, secretAad('payout.stripe'))) as GatewayCredentials;
    return { ...stripe, creds };
  } catch {
    return null;
  }
}
