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
});
