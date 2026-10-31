import { describe, it, expect, vi } from 'vitest';
import { smtpEmailSender, twilioSmsSender } from '../../src/notifications/senders';

const creds = { accountSid: 'ACxyz', authToken: 'tok', from: '+15550001111' };

describe('twilioSmsSender', () => {
  it('twilio sender posts the message with basic auth', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    await twilioSmsSender(creds, fetchFn as unknown as typeof fetch).send(
      '+15552223333',
      'hello there',
    );
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxyz/Messages.json');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('ACxyz:tok').toString('base64')}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('To')).toBe('+15552223333');
    expect(form.get('From')).toBe('+15550001111');
    expect(form.get('Body')).toBe('hello there');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('twilio errors surface status and message', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ message: 'Invalid To' }), { status: 400 }),
    );
    await expect(
      twilioSmsSender(creds, fetchFn as unknown as typeof fetch).send('x', 'y'),
    ).rejects.toThrow('Twilio 400: Invalid To');
  });
});

describe('smtpEmailSender', () => {
  it('smtp sender passes from, to, subject and text', async () => {
    const sendMail = vi.fn(async () => ({}));
    const createTransport = vi.fn(() => ({ sendMail }));
    const sender = smtpEmailSender(
      { url: 'smtp://u:p@mail.example:587', from: 'Slots <no-reply@example.com>' },
      createTransport as never,
    );
    await sender.send({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    await sender.send({ to: 'c@d.com', subject: 'Hi2', text: 'Body2' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Slots <no-reply@example.com>',
      to: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
    });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'smtp://u:p@mail.example:587',
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      }),
    );
  });
});
