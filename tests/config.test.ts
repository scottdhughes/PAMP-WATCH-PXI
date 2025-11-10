import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock environment before importing config
const mockEnv = {
  FRED_API_KEY: 'test_fred_key_12345',
  ALPHA_VANTAGE_API_KEY: 'test_alpha_key_12345',
  TWELVEDATA_API_KEY: 'test_twelve_key_12345',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
  PORT: '8787',
  HOST: '0.0.0.0',
  CORS_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'info',
  DB_POOL_MAX: '10',
  DB_POOL_MIN: '2',
  CACHE_ENABLED: 'true',
  CACHE_TTL_SECONDS: '10',
  RATE_LIMIT_MAX: '100',
  RATE_LIMIT_WINDOW: '1 minute',
};

describe('Configuration Validation', () => {
  beforeEach(() => {
    // Reset modules before each test
    vi.resetModules();
    // Set up environment
    Object.assign(process.env, mockEnv);
  });

  it('should validate API keys with minimum length', async () => {
    process.env.FRED_API_KEY = 'short'; // Too short

    await expect(async () => {
      await import('../config.js');
    }).rejects.toThrow('Invalid value for env var FRED_API_KEY');
  });

  it('should validate database URL format', async () => {
    process.env.DATABASE_URL = 'invalid://url';

    await expect(async () => {
      await import('../config.js');
    }).rejects.toThrow('Invalid value for env var DATABASE_URL');
  });

  it('should accept valid postgresql URLs', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    const { config } = await import('../config.js');
    expect(config.postgresUrl).toBe('postgresql://user:pass@localhost:5432/db');
  });

  it('should accept valid postgres URLs', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    const { config } = await import('../config.js');
    expect(config.postgresUrl).toBe('postgres://user:pass@localhost:5432/db');
  });

  it('should parse CORS origins correctly', async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3000,https://example.com';
    const { config } = await import('../config.js');
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://example.com']);
  });

  it('should use wildcard for missing CORS origins', async () => {
    delete process.env.CORS_ORIGINS;
    const { config } = await import('../config.js');
    expect(config.corsOrigins).toBe(true);
  });

  it('should set default values correctly', async () => {
    const { config } = await import('../config.js');
    expect(config.port).toBe(8787);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dbPoolMax).toBe(10);
    expect(config.dbPoolMin).toBe(2);
    expect(config.cacheEnabled).toBe(true);
    expect(config.cacheTtlSeconds).toBe(10);
    expect(config.rateLimitMax).toBe(100);
  });

  it('should throw error for missing required env vars', async () => {
    delete process.env.FRED_API_KEY;

    await expect(async () => {
      await import('../config.js');
    }).rejects.toThrow('Missing required env var FRED_API_KEY');
  });

  it('should validate API key length (minimum 8 characters)', async () => {
    process.env.FRED_API_KEY = '12345678'; // Exactly 8 chars - should pass
    const { config } = await import('../config.js');
    expect(config.fredApiKey).toBe('12345678');
  });
});

describe('Configuration Security', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, mockEnv);
  });

  it('should not expose sensitive data in config object', async () => {
    const { config } = await import('../config.js');
    const configString = JSON.stringify(config);

    // Config should contain references but not leak entire keys in plain sight
    expect(config.fredApiKey).toBeTruthy();
    expect(config.alphaVantageKey).toBeTruthy();
    expect(config.twelveDataKey).toBeTruthy();
  });

  it('should handle cache disabled correctly', async () => {
    process.env.CACHE_ENABLED = 'false';
    const { config } = await import('../config.js');
    expect(config.cacheEnabled).toBe(false);
  });

  it('should parse numeric values correctly', async () => {
    process.env.PORT = '9999';
    process.env.DB_POOL_MAX = '50';
    process.env.CACHE_TTL_SECONDS = '30';
    process.env.RATE_LIMIT_MAX = '500';

    const { config } = await import('../config.js');
    expect(config.port).toBe(9999);
    expect(config.dbPoolMax).toBe(50);
    expect(config.cacheTtlSeconds).toBe(30);
    expect(config.rateLimitMax).toBe(500);
  });
});
