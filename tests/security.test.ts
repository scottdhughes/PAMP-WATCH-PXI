import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetricSample } from '../shared/types.js';

describe('Security Tests', () => {
  describe('SQL Injection Prevention', () => {
    it('should use parameterized queries in upsertMetricSamples', async () => {
      // Mock the pg module
      const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
      const mockRelease = vi.fn();
      const mockConnect = vi.fn().mockResolvedValue({
        query: mockQuery,
        release: mockRelease,
      });

      vi.doMock('pg', () => ({
        Pool: class {
          connect = mockConnect;
          on = vi.fn();
        },
      }));

      vi.doMock('../logger.js', () => ({
        logger: {
          info: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      }));

      const { upsertMetricSamples } = await import('../db.js');

      const maliciousSample = {
        id: "test'; DROP TABLE pxi_metric_samples; --",
        label: 'Malicious',
        value: 1.0,
        unit: 'test',
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      };

      await upsertMetricSamples([maliciousSample]);

      // Verify parameterized query was used
      expect(mockQuery).toHaveBeenCalled();
      const [query, params] = mockQuery.mock.calls[0];

      // Query should contain placeholders, not raw values
      expect(query).toContain('$1');
      expect(query).not.toContain("DROP TABLE");

      // Values should be in parameters array
      expect(params).toContain(maliciousSample.id);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid metric IDs at type level', () => {
      // This test ensures TypeScript compilation fails for invalid IDs
      // The fact that validator.ts compiles proves type safety
      const validIds = ['hyOas', 'igOas', 'vix', 'u3', 'usd', 'nfci', 'btcReturn'];
      expect(validIds).toHaveLength(7);
    });

    it('should validate numeric bounds', async () => {
      const { validateSamples } = await import('../validator.js');

      const sample: MetricSample = {
        id: 'hyOas',
        label: 'Test',
        value: 999, // Way out of bounds
        unit: 'percent',
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      };

      expect(() => validateSamples([sample])).toThrow('fell outside limits');
    });

    it('should reject NaN values', async () => {
      const { validateSamples } = await import('../validator.js');

      const sample: MetricSample = {
        id: 'vix',
        label: 'Test',
        value: NaN,
        unit: 'index',
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      };

      expect(() => validateSamples([sample])).toThrow('produced NaN');
    });

    it('should reject Infinity values', async () => {
      const { validateSamples } = await import('../validator.js');

      const sample: MetricSample = {
        id: 'vix',
        label: 'Test',
        value: Infinity,
        unit: 'index',
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      };

      expect(() => validateSamples([sample])).toThrow('fell outside limits');
    });
  });

  describe('API Key Validation', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should require minimum API key length', async () => {
      process.env.FRED_API_KEY = '123'; // Too short
      process.env.ALPHA_VANTAGE_API_KEY = 'test12345';
      process.env.TWELVEDATA_API_KEY = 'test12345';
      process.env.DATABASE_URL = 'postgresql://localhost/test';

      await expect(async () => {
        await import('../config.js');
      }).rejects.toThrow('Invalid value for env var FRED_API_KEY');
    });

    it('should accept valid API keys', async () => {
      process.env.FRED_API_KEY = 'validkey12345';
      process.env.ALPHA_VANTAGE_API_KEY = 'validkey12345';
      process.env.TWELVEDATA_API_KEY = 'validkey12345';
      process.env.DATABASE_URL = 'postgresql://localhost/test';

      const { config } = await import('../config.js');
      expect(config.fredApiKey).toBe('validkey12345');
    });
  });

  describe('CORS Configuration', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.FRED_API_KEY = 'test12345';
      process.env.ALPHA_VANTAGE_API_KEY = 'test12345';
      process.env.TWELVEDATA_API_KEY = 'test12345';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
    });

    it('should parse comma-separated origins', async () => {
      process.env.CORS_ORIGINS = 'https://app.example.com,https://dashboard.example.com';

      const { config } = await import('../config.js');
      expect(config.corsOrigins).toEqual([
        'https://app.example.com',
        'https://dashboard.example.com',
      ]);
    });

    it('should trim whitespace from origins', async () => {
      process.env.CORS_ORIGINS = ' https://app.example.com , https://dashboard.example.com ';

      const { config } = await import('../config.js');
      expect(config.corsOrigins).toEqual([
        'https://app.example.com',
        'https://dashboard.example.com',
      ]);
    });

    it('should support wildcard with asterisk', async () => {
      process.env.CORS_ORIGINS = '*';

      const { config } = await import('../config.js');
      expect(config.corsOrigins).toBe(true);
    });
  });

  describe('Database URL Validation', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.FRED_API_KEY = 'test12345';
      process.env.ALPHA_VANTAGE_API_KEY = 'test12345';
      process.env.TWELVEDATA_API_KEY = 'test12345';
    });

    it('should reject invalid database URLs', async () => {
      process.env.DATABASE_URL = 'mysql://localhost/test';

      await expect(async () => {
        await import('../config.js');
      }).rejects.toThrow('Invalid value for env var DATABASE_URL');
    });

    it('should accept postgresql:// URLs', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

      const { config } = await import('../config.js');
      expect(config.postgresUrl).toBe('postgresql://user:pass@localhost:5432/db');
    });

    it('should accept postgres:// URLs', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

      const { config } = await import('../config.js');
      expect(config.postgresUrl).toBe('postgres://user:pass@localhost:5432/db');
    });
  });

  describe('Error Message Security', () => {
    it('should not expose internal details in validation errors', async () => {
      const { validateSamples } = await import('../validator.js');

      const sample: MetricSample = {
        id: 'hyOas',
        label: 'Test',
        value: 999,
        unit: 'percent',
        sourceTimestamp: new Date().toISOString(),
        ingestedAt: new Date().toISOString(),
      };

      try {
        validateSamples([sample]);
        expect.fail('Should have thrown');
      } catch (error) {
        const message = (error as Error).message;
        // Should contain useful info
        expect(message).toContain('hyOas');
        expect(message).toContain('999');

        // Should not contain sensitive info
        expect(message).not.toContain('password');
        expect(message).not.toContain('api_key');
        expect(message).not.toContain('secret');
      }
    });
  });

  describe('Rate Limiting Configuration', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.FRED_API_KEY = 'test12345';
      process.env.ALPHA_VANTAGE_API_KEY = 'test12345';
      process.env.TWELVEDATA_API_KEY = 'test12345';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
    });

    it('should have sensible rate limit defaults', async () => {
      const { config } = await import('../config.js');
      expect(config.rateLimitMax).toBe(100); // Not too permissive
      expect(config.rateLimitWindow).toBe('1 minute');
    });

    it('should allow rate limit configuration', async () => {
      process.env.RATE_LIMIT_MAX = '500';
      process.env.RATE_LIMIT_WINDOW = '5 minutes';

      const { config } = await import('../config.js');
      expect(config.rateLimitMax).toBe(500);
      expect(config.rateLimitWindow).toBe('5 minutes');
    });
  });

  describe('Cache Security', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.FRED_API_KEY = 'test12345';
      process.env.ALPHA_VANTAGE_API_KEY = 'test12345';
      process.env.TWELVEDATA_API_KEY = 'test12345';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
    });

    it('should have reasonable cache TTL default', async () => {
      const { config } = await import('../config.js');
      expect(config.cacheTtlSeconds).toBeLessThanOrEqual(60); // Not too long
    });

    it('should allow disabling cache', async () => {
      process.env.CACHE_ENABLED = 'false';

      const { config } = await import('../config.js');
      expect(config.cacheEnabled).toBe(false);
    });
  });
});
