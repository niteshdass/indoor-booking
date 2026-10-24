import nodemailer from 'nodemailer';
import type { EmailSender, SmsSender } from '../services';

/** Bounds every outbound call: the job runner is serial, so a hung provider would stall all jobs. */
const TIMEOUT_MS = 10_000;

export function smtpEmailSender(
  opts: { url: string; from: string },
  createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
): EmailSender {
  const transport = createTransport({
    url: opts.url,
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
