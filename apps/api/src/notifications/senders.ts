import nodemailer from 'nodemailer';
import type { EmailSettings } from '../admin/settings';
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
