import { Router } from 'express';
import { z } from 'zod';
import { BD_SMS_PROVIDERS, DEFAULT_PLATFORM_FEE, OWNER_APPROVAL_MODES, FEE_PAYERS, PLATFORM_FEE_MAX_PERCENT, PLATFORM_FEE_MODES, SPORTS, mergeSportSettings } from '@booking/shared';
import type { AdminSettingsJson, BdSmsProvider, SettingSource } from '@booking/shared';
import { User } from '../../auth/user.model';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { gatewayFor } from '../../payments/gateway';
import { GATEWAY_MODES, type GatewayMode } from '../../payments/gateway.model';
import { sameKeyMode, stripeKeyFields } from '../../payments/routes/gateways';
import { seal } from '../../payments/secretBox';
import { walletSchema } from '../../venues/settingsSchema';
import type { AppServices } from '../../services';
import { platformOf, requirePlatform } from '../context';
import { logPlatform } from '../platformLog.model';
import { PlatformSettings, SETTINGS_ID, clearSettingsCache, secretAad, walletOf, type PlatformSettingsDoc } from '../settings';

const GOOGLE_CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;
const TWILIO_SID_RE = /^AC[0-9a-f]{32}$/i;
const E164_RE = /^\+[1-9]\d{6,14}$/;

const googleBody = z.object({ clientId: z.string().trim().regex(GOOGLE_CLIENT_ID_RE, 'Must be a Google OAuth web client ID') }).strict();

/** A blank password keeps the saved one; `clearPassword` drops it (servers without sign-in). */
const emailBody = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: z.string().trim().max(255).optional(),
    password: z.string().max(1024).optional(),
    from: z.string().trim().min(3).max(320),
  })
  .strict();

/** A blank auth token keeps the saved one. */
const smsBody = z
  .object({
    accountSid: z.string().trim().regex(TWILIO_SID_RE, 'Must be a Twilio Account SID (AC…)'),
    authToken: z.string().trim().max(256).optional(),
    from: z.string().trim().regex(E164_RE, 'Must be a phone number in international format, e.g. +15550001111'),
  })
  .strict();

/** A blank API key keeps the saved one while the provider stays the same. */
const smsBdBody = z
  .object({
    provider: z.enum(BD_SMS_PROVIDERS),
    apiKey: z.string().trim().max(256).optional(),
    senderId: z.string().trim().regex(/^[\w .+-]{1,32}$/, 'Must be the sender ID or masking name your provider approved'),
  })
  .strict();

const smsMeteringBody = z.object({ metered: z.boolean() }).strict();

/** At most two decimals: money amounts are stored in major units but charged in minor ones. */
const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const amount = (max: number) => z.number().finite().gt(0).max(max).refine(twoDecimals, 'Use at most 2 decimals');

const feeSchema = z
  .object({
    mode: z.enum(PLATFORM_FEE_MODES),
    fixed: amount(1_000_000).nullable(),
    percent: amount(PLATFORM_FEE_MAX_PERCENT).nullable(),
    payer: z.enum(FEE_PAYERS),
  })
  .strict()
  .superRefine((f, ctx) => {
    const need = (field: 'fixed' | 'percent', wanted: boolean) => {
      if (wanted && f[field] === null) ctx.addIssue({ code: 'custom', path: [field], message: `Enter the ${field} fee` });
      if (!wanted && f[field] !== null) ctx.addIssue({ code: 'custom', path: [field], message: `The ${f.mode} fee takes no ${field} amount` });
    };
    need('fixed', f.mode === 'fixed');
    need('percent', f.mode === 'percent');
  });

/** Each slot takes its own provider's wallet. */
const payoutWallet = (provider: 'bkash' | 'nagad') =>
  walletSchema.nullable().refine((w) => !w || w.provider === provider, { message: `Must be a ${provider} wallet` });

const generalBody = z
  .object({
    ownerApproval: z.enum(OWNER_APPROVAL_MODES),
    fee: feeSchema,
    payout: z.object({ bkash: payoutWallet('bkash'), nagad: payoutWallet('nagad') }).strict(),
  })
  .strict();

const payoutStripeBody = z
  .object({ mode: z.enum(GATEWAY_MODES), ...stripeKeyFields, enabled: z.boolean() })
  .strict()
  .refine(sameKeyMode.check, sameKeyMode.issue);

/** The whole catalog, each sport once, in the order to show it. */
const sportsBody = z
  .object({
    sports: z
      .array(z.object({ sport: z.enum(SPORTS), enabled: z.boolean() }).strict())
      .length(SPORTS.length)
      .refine((list) => new Set(list.map((s) => s.sport)).size === SPORTS.length, 'List every sport once')
      .refine((list) => list.some((s) => s.enabled), 'Keep at least one sport on'),
  })
  .strict();

const testEmailBody = z.object({ to: z.string().trim().email() }).strict();
const testSmsBody = z.object({ to: z.string().trim().regex(E164_RE, 'Must be a phone number in international format') }).strict();

const SECTIONS = ['google', 'email', 'sms'] as const;
const sectionParam = z.enum(SECTIONS);

const source = (saved: unknown, server: unknown): SettingSource => (saved ? 'admin' : server ? 'server' : 'none');

async function settingsJson(config: Config, doc: PlatformSettingsDoc | null): Promise<AdminSettingsJson> {
  const ps = doc?.general?.payout?.stripe;
  const pub = (k: { publishableKey: string; accountId: string } | null | undefined) =>
    k ? { publishableKey: k.publishableKey, accountId: k.accountId } : null;
  const payoutStripe = ps ? { mode: ps.mode, enabled: ps.enabled, keys: { test: pub(ps.keys?.test), live: pub(ps.keys?.live) } } : null;
  const by = doc?.updatedBy ? await User.findById(doc.updatedBy, { name: 1 }).lean() : null;
  return {
    google: {
      source: source(doc?.google, config.googleClientId),
      clientId: doc?.google?.clientId ?? config.googleClientId ?? null,
    },
    email: {
      source: source(doc?.email, config.email),
      smtp: doc?.email
        ? {
            host: doc.email.host,
            port: doc.email.port,
            secure: doc.email.secure,
            user: doc.email.user ?? null,
            from: doc.email.from,
            passwordSet: Boolean(doc.email.passwordSealed),
          }
        : null,
    },
    sms: {
      source: source(doc?.sms, config.sms),
      twilio: doc?.sms ? { accountSid: doc.sms.accountSid, from: doc.sms.from, authTokenSet: true } : null,
      bd: {
        source: source(doc?.smsBd, config.smsBd),
        provider: (doc?.smsBd?.provider as BdSmsProvider | undefined) ?? null,
        senderId: doc?.smsBd?.senderId ?? null,
        apiKeySet: Boolean(doc?.smsBd),
      },
      metered: doc?.smsMetered === true,
    },
    general: {
      ownerApproval: doc?.general?.ownerApproval ?? 'manual',
      fee: doc?.general
        ? { ...doc.general.fee, fixed: doc.general.fee.fixed ?? null, percent: doc.general.fee.percent ?? null }
        : { ...DEFAULT_PLATFORM_FEE },
      payout: {
        bkash: walletOf(doc?.general?.payout?.bkash),
        nagad: walletOf(doc?.general?.payout?.nagad),
        stripe: payoutStripe,
      },
      payoutWebhookUrl: `${config.apiUrl}/api/v1/webhooks/stripe/platform`,
    },
    sports: mergeSportSettings(doc?.sports),
    secretsAvailable: Boolean(config.paymentsKey),
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
    updatedBy: by?.name ?? null,
  };
}

type StoredKeys = { credentialsEncrypted: string; publishableKey: string; accountId: string } | null;
type StoredPayoutStripe = { mode: GatewayMode; enabled: boolean; keys: Record<GatewayMode, StoredKeys> };
type GeneralDoc = {
  ownerApproval: (typeof OWNER_APPROVAL_MODES)[number];
  fee: { mode: (typeof PLATFORM_FEE_MODES)[number]; fixed: number | null; percent: number | null; payer: (typeof FEE_PAYERS)[number] };
  payout: { bkash: unknown; nagad: unknown; stripe: StoredPayoutStripe | null };
};

const noKey = () => new AppError(503, 'payments_unconfigured', 'This server has no encryption key, so secrets cannot be saved');

/** A provider rejected the test message; its reason is shown to the admin. */
const deliveryFailed = (err: unknown) =>
  err instanceof AppError ? err : new AppError(502, 'delivery_failed', err instanceof Error ? err.message : 'The message could not be sent');

/** Sign-in and delivery providers (`platform.settings`). Saved values win over the server env; removing one falls back to it. */
export function adminSettingsRouter(config: Config, services: AppServices): Router {
  const router = Router();
  router.use('/settings', requirePlatform('platform.settings'));

  const current = async () => {
    clearSettingsCache();
    return PlatformSettings.findById(SETTINGS_ID).lean<PlatformSettingsDoc>();
  };
  const save = async (actorId: string, set: Record<string, unknown>) => {
    await PlatformSettings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { ...set, updatedAt: services.now(), updatedBy: actorId } },
      { upsert: true },
    );
    return current();
  };

  router.get('/settings', async (_req, res) => {
    res.json(await settingsJson(config, await current()));
  });

  router.put('/settings/google', async (req, res) => {
    const body = googleBody.parse(req.body);
    res.json(await settingsJson(config, await save(platformOf(req).userId, { google: { clientId: body.clientId } })));
  });

  router.put('/settings/email', async (req, res) => {
    const body = emailBody.parse(req.body);
    const key = config.paymentsKey;
    if (!key) throw noKey();
    const saved = (await current())?.email;
    const user = body.user || null;
    let passwordSealed: string | null = null;
    if (user) {
      if (body.password) passwordSealed = seal(body.password, key, secretAad('smtp.password'));
      // Same login, blank password: keep the one already saved.
      else if (saved?.passwordSealed && saved.user === user) passwordSealed = saved.passwordSealed;
      else throw new AppError(400, 'secret_required', 'Enter the SMTP password');
    }
    const email = { host: body.host, port: body.port, secure: body.secure, user, passwordSealed, from: body.from };
    res.json(await settingsJson(config, await save(platformOf(req).userId, { email })));
  });

  router.put('/settings/sms', async (req, res) => {
    const body = smsBody.parse(req.body);
    const key = config.paymentsKey;
    if (!key) throw noKey();
    const saved = (await current())?.sms;
    let authTokenSealed: string;
    if (body.authToken) authTokenSealed = seal(body.authToken, key, secretAad('twilio.authToken'));
    else if (saved && saved.accountSid === body.accountSid) authTokenSealed = saved.authTokenSealed;
    else throw new AppError(400, 'secret_required', 'Enter the Twilio auth token');
    const sms = { accountSid: body.accountSid, authTokenSealed, from: body.from };
    res.json(await settingsJson(config, await save(platformOf(req).userId, { sms })));
  });

  router.put('/settings/sms-bd', async (req, res) => {
    const body = smsBdBody.parse(req.body);
    const key = config.paymentsKey;
    if (!key) throw noKey();
    const saved = (await current())?.smsBd;
    let apiKeySealed: string;
    if (body.apiKey) apiKeySealed = seal(body.apiKey, key, secretAad('smsBd.apiKey'));
    else if (saved && saved.provider === body.provider) apiKeySealed = saved.apiKeySealed;
    else throw new AppError(400, 'secret_required', 'Enter the API key');
    const smsBd = { provider: body.provider, apiKeySealed, senderId: body.senderId };
    res.json(await settingsJson(config, await save(platformOf(req).userId, { smsBd })));
  });

  router.delete('/settings/sms-bd', async (req, res) => {
    res.json(await settingsJson(config, await save(platformOf(req).userId, { smsBd: null })));
  });

  router.put('/settings/sms-metering', async (req, res) => {
    const { metered } = smsMeteringBody.parse(req.body);
    const actorId = platformOf(req).userId;
    const doc = await save(actorId, { smsMetered: metered });
    await logPlatform(actorId, { action: metered ? 'settings.sms_metering_on' : 'settings.sms_metering_off', entity: 'user', entityId: actorId }, services.now());
    res.json(await settingsJson(config, doc));
  });

  /** Replaces part of the general settings, keeping the rest (the payout Stripe keys live beside the fee). */
  const saveGeneral = async (actorId: string, patch: (g: GeneralDoc) => GeneralDoc) => {
    const g = (await current())?.general;
    const base: GeneralDoc = {
      ownerApproval: g?.ownerApproval ?? 'manual',
      fee: g ? { mode: g.fee.mode, fixed: g.fee.fixed ?? null, percent: g.fee.percent ?? null, payer: g.fee.payer } : { ...DEFAULT_PLATFORM_FEE },
      payout: {
        bkash: g?.payout?.bkash ?? null,
        nagad: g?.payout?.nagad ?? null,
        stripe: g?.payout?.stripe
          ? { mode: g.payout.stripe.mode, enabled: g.payout.stripe.enabled, keys: { test: g.payout.stripe.keys?.test ?? null, live: g.payout.stripe.keys?.live ?? null } }
          : null,
      },
    };
    const doc = await save(actorId, { general: patch(base) });
    // Settings are platform-wide, so the entry is filed against the admin who saved them.
    await logPlatform(actorId, { action: 'settings.general_updated', entity: 'user', entityId: actorId }, services.now());
    return doc;
  };

  router.put('/settings/general', async (req, res) => {
    const body = generalBody.parse(req.body);
    const doc = await saveGeneral(platformOf(req).userId, (g) => ({
      ...g,
      ownerApproval: body.ownerApproval,
      fee: body.fee,
      payout: { ...g.payout, bkash: body.payout.bkash, nagad: body.payout.nagad },
    }));
    res.json(await settingsJson(config, doc));
  });

  router.put('/settings/sports', async (req, res) => {
    const { sports } = sportsBody.parse(req.body);
    const actorId = platformOf(req).userId;
    const doc = await save(actorId, { sports });
    await logPlatform(actorId, { action: 'settings.sports_updated', entity: 'user', entityId: actorId }, services.now());
    res.json(await settingsJson(config, doc));
  });

  router.put('/settings/payout-stripe', async (req, res) => {
    const body = payoutStripeBody.parse(req.body);
    const key = config.paymentsKey;
    if (!key) throw noKey();
    const gateway = gatewayFor(services, 'stripe');
    if (!gateway) throw new AppError(404, 'not_found', 'Payment gateway not found');
    const creds = { secretKey: body.secretKey, webhookSecret: body.webhookSecret };
    const { accountId } = await gateway.verifyCredentials(creds);
    const keyMode = body.secretKey.split('_')[1] as GatewayMode;
    const set = { credentialsEncrypted: seal(JSON.stringify(creds), key, secretAad('payout.stripe')), publishableKey: body.publishableKey, accountId };
    const doc = await saveGeneral(platformOf(req).userId, (g) => {
      const keys: Record<GatewayMode, StoredKeys> = { test: g.payout.stripe?.keys?.test ?? null, live: g.payout.stripe?.keys?.live ?? null };
      keys[keyMode] = set;
      // The active mode must have keys: adding the other mode's keys does not switch unless asked.
      if (!keys[body.mode]) throw new AppError(400, 'gateway_mode_not_connected', 'Add the keys for this mode first');
      return { ...g, payout: { ...g.payout, stripe: { mode: body.mode, enabled: body.enabled, keys } } };
    });
    res.json(await settingsJson(config, doc));
  });

  router.delete('/settings/payout-stripe', async (req, res) => {
    const doc = await saveGeneral(platformOf(req).userId, (g) => ({ ...g, payout: { ...g.payout, stripe: null } }));
    res.json(await settingsJson(config, doc));
  });

  router.delete('/settings/:section', async (req, res) => {
    const section = sectionParam.parse(req.params.section);
    res.json(await settingsJson(config, await save(platformOf(req).userId, { [section]: null })));
  });

  router.post('/settings/email/test', async (req, res) => {
    const { to } = testEmailBody.parse(req.body);
    try {
      await services.email.send({
        to,
        subject: 'Test email',
        text: 'This is a test message from the admin dashboard. Email delivery works.',
      });
    } catch (err) {
      throw deliveryFailed(err);
    }
    res.status(204).end();
  });

  router.post('/settings/sms/test', async (req, res) => {
    const { to } = testSmsBody.parse(req.body);
    try {
      await services.sms.send(to, 'Test message from the admin dashboard. SMS delivery works.');
    } catch (err) {
      throw deliveryFailed(err);
    }
    res.status(204).end();
  });

  return router;
}
