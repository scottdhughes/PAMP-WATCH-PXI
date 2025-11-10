import { describe, it, expect, vi } from 'vitest';
import { validateSamples } from '../validator.js';
import type { MetricSample } from '../shared/types.js';

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Validator - validateSamples', () => {
  const createSample = (overrides: Partial<MetricSample> = {}): MetricSample => ({
    id: 'hyOas',
    label: 'HY OAS',
    value: 0.05,
    unit: 'percent',
    sourceTimestamp: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    ...overrides,
  });

  describe('Hard Limits Validation', () => {
    it('should accept values within limits', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.05 }),
        createSample({ id: 'igOas', value: 0.03 }),
        createSample({ id: 'vix', value: 20 }),
      ];

      expect(() => validateSamples(samples)).not.toThrow();
    });

    it('should reject NaN values', () => {
      const samples = [createSample({ value: NaN })];

      expect(() => validateSamples(samples)).toThrow('produced NaN');
    });

    it('should reject values below minimum', () => {
      const samples = [createSample({ id: 'hyOas', value: -0.1 })];

      expect(() => validateSamples(samples)).toThrow('fell outside limits');
    });

    it('should reject values above maximum', () => {
      const samples = [createSample({ id: 'hyOas', value: 0.3 })];

      expect(() => validateSamples(samples)).toThrow('fell outside limits');
    });

    it('should validate VIX bounds (5-120)', () => {
      expect(() =>
        validateSamples([createSample({ id: 'vix', value: 4 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'vix', value: 121 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'vix', value: 50 })]),
      ).not.toThrow();
    });

    it('should validate U-3 unemployment bounds (0.02-0.25)', () => {
      expect(() =>
        validateSamples([createSample({ id: 'u3', value: 0.01 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'u3', value: 0.26 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'u3', value: 0.05 })]),
      ).not.toThrow();
    });

    it('should validate USD index bounds (70-120)', () => {
      expect(() =>
        validateSamples([createSample({ id: 'usd', value: 69 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'usd', value: 121 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'usd', value: 100 })]),
      ).not.toThrow();
    });

    it('should validate NFCI bounds (-2 to 5)', () => {
      expect(() =>
        validateSamples([createSample({ id: 'nfci', value: -2.1 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'nfci', value: 5.1 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'nfci', value: 0.5 })]),
      ).not.toThrow();
    });

    it('should validate BTC return bounds (-0.5 to 0.5)', () => {
      expect(() =>
        validateSamples([createSample({ id: 'btcReturn', value: -0.6 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'btcReturn', value: 0.6 })]),
      ).toThrow('fell outside limits');

      expect(() =>
        validateSamples([createSample({ id: 'btcReturn', value: 0.1 })]),
      ).not.toThrow();
    });
  });

  describe('Business Rules Validation', () => {
    it('should enforce HY OAS > IG OAS', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.03 }),
        createSample({ id: 'igOas', value: 0.05 }),
      ];

      expect(() => validateSamples(samples)).toThrow('must exceed IG OAS');
    });

    it('should allow HY OAS = IG OAS edge case to fail', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.05 }),
        createSample({ id: 'igOas', value: 0.05 }),
      ];

      expect(() => validateSamples(samples)).toThrow('must exceed IG OAS');
    });

    it('should pass when HY OAS > IG OAS', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.06 }),
        createSample({ id: 'igOas', value: 0.03 }),
      ];

      expect(() => validateSamples(samples)).not.toThrow();
    });

    it('should not enforce rule if only one spread present', () => {
      const samplesOnlyHY = [createSample({ id: 'hyOas', value: 0.05 })];
      const samplesOnlyIG = [createSample({ id: 'igOas', value: 0.03 })];

      expect(() => validateSamples(samplesOnlyHY)).not.toThrow();
      expect(() => validateSamples(samplesOnlyIG)).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty samples array', () => {
      expect(() => validateSamples([])).not.toThrow();
    });

    it('should handle samples with boundary values', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.0 }), // min
        createSample({ id: 'vix', value: 120 }), // max
      ];

      expect(() => validateSamples(samples)).not.toThrow();
    });

    it('should provide detailed error messages', () => {
      const samples = [createSample({ id: 'hyOas', value: 0.3 })];

      try {
        validateSamples(samples);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('hyOas');
        expect((error as Error).message).toContain('0.3');
        expect((error as Error).message).toContain('0.25');
      }
    });

    it('should handle multiple violations (stops at first)', () => {
      const samples = [
        createSample({ id: 'hyOas', value: 0.3 }), // Over limit
        createSample({ id: 'igOas', value: -0.1 }), // Below limit
      ];

      expect(() => validateSamples(samples)).toThrow('fell outside limits');
    });
  });

  describe('Type Safety', () => {
    it('should accept all valid MetricId types', () => {
      const allMetrics: MetricSample[] = [
        createSample({ id: 'hyOas', value: 0.05 }),
        createSample({ id: 'igOas', value: 0.02 }),
        createSample({ id: 'vix', value: 20 }),
        createSample({ id: 'u3', value: 0.04 }),
        createSample({ id: 'usd', value: 100 }),
        createSample({ id: 'nfci', value: 0 }),
        createSample({ id: 'btcReturn', value: 0.05 }),
      ];

      expect(() => validateSamples(allMetrics)).not.toThrow();
    });
  });
});
