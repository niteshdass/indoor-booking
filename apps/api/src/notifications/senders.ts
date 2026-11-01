import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { EmailSettings, SmsBdSettings } from '../admin/settings';
import type { EmailSender, SmsSender } from '../services';

/** Bounds every outbound call: the job runner is serial, so a hung provider would stall all jobs. */
const TIMEOUT_MS = 10_000;

/** `url` is an smtp:// connection string (server env); `smtp` is the fields an admin saved. */
export function smtpEmailSender(
  opts: EmailSettings,
  createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
): EmailSender {
  const server =
    'url' in opts
      ? { url: opts.url }
      : {
          host: opts.smtp.host,
          port: opts.smtp.port,
          secure: opts.smtp.secure,
          ...(opts.smtp.user ? { auth: { user: opts.smtp.user, pass: opts.smtp.password ?? '' } } : {}),
        };
  const transport = createTransport({
    ...server,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: opts.from, to, subject, text });
    },
  };
}

export function twilioSmsSender(
  opts: { accountSid: string; authToken: string; from: string },
  fetchFn: typeof fetch = fetch,
): SmsSender {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`;
  const auth = Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64');
  return {
    async send(to, text) {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: opts.from, Body: text }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(`Twilio ${res.status}: ${body.message ?? res.statusText}`);
      }
    },
  };
}

/** SSL Wireless SMS Plus (v3). `to` is E.164; the API wants it without the plus. */
export function sslWirelessSmsSender(opts: { apiKey: string; senderId: string }, fetchFn: typeof fetch = fetch): SmsSender {
  return {
    async send(to, text) {
      const res = await fetchFn('https://smsplus.sslwireless.com/api/v3/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          api_token: opts.apiKey,
          sid: opts.senderId,
          msisdn: to.replace(/^\+/, ''),
          sms: text,
          // Unique per message on their side, at most 20 characters.
          csms_id: randomBytes(10).toString('hex'),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; status_code?: number; error_message?: string };
      if (!res.ok || body.status !== 'SUCCESS') {
        throw new Error(`SSL Wireless ${body.status_code ?? res.status}: ${body.error_message || res.statusText}`);
      }
    },
  };
}

/** BulkSMSBD. A form post, so the API key stays out of the URL. */
export function bulksmsbdSmsSender(opts: { apiKey: string; senderId: string }, fetchFn: typeof fetch = fetch): SmsSender {
  return {
    async send(to, text) {
      const res = await fetchFn('https://bulksmsbd.net/api/smsapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          api_key: opts.apiKey,
          type: 'text',
          number: to.replace(/^\+/, ''),
          senderid: opts.senderId,
          message: text,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { response_code?: number; error_message?: string };
      if (!res.ok || body.response_code !== 202) {
        throw new Error(`BulkSMSBD ${body.response_code ?? res.status}: ${body.error_message || res.statusText}`);
      }
    },
  };
}

/** The sender for a Bangladesh provider's settings. */
export function bdSmsSender(opts: SmsBdSettings, fetchFn: typeof fetch = fetch): SmsSender {
  return opts.provider === 'ssl_wireless' ? sslWirelessSmsSender(opts, fetchFn) : bulksmsbdSmsSender(opts, fetchFn);
}
