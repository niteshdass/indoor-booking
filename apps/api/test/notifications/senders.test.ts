import { describe, it, expect, vi } from 'vitest';
import { bulksmsbdSmsSender, smtpEmailSender, sslWirelessSmsSender, twilioSmsSender } from '../../src/notifications/senders';

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

const bd = { apiKey: 'key-1', senderId: 'TURF' };
const asFetch = (f: unknown) => f as typeof fetch;

describe('sslWirelessSmsSender', () => {
  it('posts JSON with the number without its plus and a unique csms_id', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'SUCCESS', status_code: 200 }), { status: 200 }));
    const sender = sslWirelessSmsSender(bd, asFetch(fetchFn));
    await sender.send('+8801712345678', 'hello');
    await sender.send('+8801712345678', 'hello');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://smsplus.sslwireless.com/api/v3/send-sms');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ api_token: 'key-1', sid: 'TURF', msisdn: '8801712345678', sms: 'hello' });
    expect(body.csms_id).toMatch(/^[0-9a-f]{20}$/);
    const second = JSON.parse((fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.csms_id).not.toBe(body.csms_id);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('a refusal surfaces its code and message, even with a 200', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', status_code: 4001, error_message: 'Invalid sid' }), { status: 200 }));
    await expect(sslWirelessSmsSender(bd, asFetch(fetchFn)).send('+8801712345678', 'x')).rejects.toThrow('SSL Wireless 4001: Invalid sid');
  });
});

describe('bulksmsbdSmsSender', () => {
  it('posts a form, keeping the key out of the URL', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response_code: 202 }), { status: 200 }));
    await bulksmsbdSmsSender(bd, asFetch(fetchFn)).send('+8801712345678', 'hello');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://bulksmsbd.net/api/smsapi');
    const form = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(form)).toEqual({ api_key: 'key-1', type: 'text', number: '8801712345678', senderid: 'TURF', message: 'hello' });
  });
  it('anything but 202 is a failure', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response_code: 1007, error_message: 'Balance Insufficient' }), { status: 200 }));
    await expect(bulksmsbdSmsSender(bd, asFetch(fetchFn)).send('+8801712345678', 'x')).rejects.toThrow('BulkSMSBD 1007: Balance Insufficient');
  });
});
