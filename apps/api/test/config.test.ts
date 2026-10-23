import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../src/config';

describe('loadConfig', () => {
  it('throws naming MONGODB_URI when missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/MONGODB_URI/);
  });
  it('applies defaults', () => {
    expect(loadConfig({ MONGODB_URI: 'mongodb://x' })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      mongodbUri: 'mongodb://x',
      corsOrigin: 'http://localhost:5173',
    });
  });
  it('rejects non-numeric PORT', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://x', PORT: 'abc' })).toThrow(/PORT/);
  });
});
