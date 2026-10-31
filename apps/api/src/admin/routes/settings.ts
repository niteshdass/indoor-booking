import { Router } from 'express';
import { z } from 'zod';
import type { AdminSettingsJson, SettingSource } from '@booking/shared';
import { User } from '../../auth/user.model';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { seal } from '../../payments/secretBox';
import type { AppServices } from '../../services';
import { platformOf, requirePlatform } from '../context';
import { PlatformSettings, SETTINGS_ID, clearSettingsCache, secretAad, type PlatformSettingsDoc } from '../settings';

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

const testEmailBody = z.object({ to: z.string().trim().email() }).strict();
const testSmsBody = z.object({ to: z.string().trim().regex(E164_RE, 'Must be a phone number in international format') }).strict();

const SECTIONS = ['google', 'email', 'sms'] as const;
const sectionParam = z.enum(SECTIONS);

const source = (saved: unknown, server: unknown): SettingSource => (saved ? 'admin' : server ? 'server' : 'none');

async function settingsJson(config: Config, doc: PlatformSettingsDoc | null): Promise<AdminSettingsJson> {
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
    },
    secretsAvailable: Boolean(config.paymentsKey),
    updatedAt: doc?.updatedAt ? doc.updatedAt.toISOString() : null,
    updatedBy: by?.name ?? null,
  };
}

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
