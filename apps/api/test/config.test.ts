import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../src/config';

describe('loadConfig', () => {
  it('throws naming MONGODB_URI when missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/MONGODB_URI/);
  });
  it('applies defaults', () => {
    expect(loadConfig({ MONGODB_URI: 'mongodb://x', JWT_SECRET: 's'.repeat(32) })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      mongodbUri: 'mongodb://x',
      corsOrigin: 'http://localhost:5173',
      jwtSecret: 's'.repeat(32),
      appUrl: 'http://localhost:5173',
      apiUrl: 'http://localhost:4000',
      jobsEnabled: true,
    });
  });
  it('rejects non-numeric PORT', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://x', PORT: 'abc' })).toThrow(/PORT/);
  });
  it('rejects JWT_SECRET shorter than 32 chars', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://x', JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
  it('reads GOOGLE_CLIENT_ID and APP_URL', () => {
    const c = loadConfig({
      MONGODB_URI: 'mongodb://x',
      JWT_SECRET: 's'.repeat(32),
      GOOGLE_CLIENT_ID: 'gid',
      APP_URL: 'https://app.example',
    });
    expect(c.googleClientId).toBe('gid');
    expect(c.appUrl).toBe('https://app.example');
  });
  describe('jobs', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 's'.repeat(32) };
    it('runs jobs unless JOBS_ENABLED=false', () => {
      expect(loadConfig(base).jobsEnabled).toBe(true);
      expect(loadConfig({ ...base, JOBS_ENABLED: 'true' }).jobsEnabled).toBe(true);
      expect(loadConfig({ ...base, JOBS_ENABLED: 'false' }).jobsEnabled).toBe(false);
    });
    it('rejects another JOBS_ENABLED value', () => {
      expect(() => loadConfig({ ...base, JOBS_ENABLED: 'no' })).toThrow(/JOBS_ENABLED/);
    });
  });
  describe('payments', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 's'.repeat(32) };
    it('decodes a 32-byte PAYMENTS_ENCRYPTION_KEY', () => {
      const c = loadConfig({ ...base, PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
      expect(c.paymentsKey?.length).toBe(32);
    });
    it('rejects a key that is not 32 bytes', () => {
      const env = { ...base, PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(/PAYMENTS_ENCRYPTION_KEY/);
    });
    it('requires the key in production only', () => {
      expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/PAYMENTS_ENCRYPTION_KEY/);
      expect(loadConfig({ ...base, NODE_ENV: 'development' }).paymentsKey).toBeUndefined();
    });
    it('defaults and reads API_URL', () => {
      expect(loadConfig(base).apiUrl).toBe('http://localhost:4000');
      expect(loadConfig({ ...base, API_URL: 'https://api.example' }).apiUrl).toBe('https://api.example');
    });
  });
  describe('notification senders', () => {
    const base = { MONGODB_URI: 'mongodb://x', JWT_SECRET: 's'.repeat(32) };
    const email = { SMTP_URL: 'smtp://mail.example:587', EMAIL_FROM: 'no-reply@example.com' };
    const sms = {
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM: '+15550001111',
    };
    it('rejects a partial email group naming the missing key', () => {
      const env = { ...base, SMTP_URL: email.SMTP_URL };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(/EMAIL_FROM/);
    });
    it('rejects a partial sms group naming the missing keys', () => {
      expect(() => loadConfig({ ...base, TWILIO_ACCOUNT_SID: 'AC1' })).toThrow(/TWILIO_AUTH_TOKEN/);
    });
    it('requires both groups in production', () => {
      const prod = {
        ...base,
        NODE_ENV: 'production',
        PAYMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      };
      expect(() => loadConfig({ ...prod, ...email })).toThrow(/TWILIO_ACCOUNT_SID/);
      expect(() => loadConfig({ ...prod, ...sms })).toThrow(/SMTP_URL/);
      expect(loadConfig({ ...prod, ...email, ...sms }).nodeEnv).toBe('production');
    });
    it('parses both groups when set', () => {
      const c = loadConfig({ ...base, ...email, ...sms });
      expect(c.email).toEqual({ smtpUrl: 'smtp://mail.example:587', from: 'no-reply@example.com' });
      expect(c.sms).toEqual({ accountSid: 'AC1', authToken: 'tok', from: '+15550001111' });
      expect(loadConfig(base).email).toBeUndefined();
    });
  });
});
