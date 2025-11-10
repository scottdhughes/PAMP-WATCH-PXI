import { describe, expect, it } from 'vitest';
import { validateSamples } from './validator.js';
import { MetricSample } from './types.js';

const baseSample = (overrides: Partial<MetricSample> = {}): MetricSample => ({
  id: 'hyOas',
  label: 'HY OAS',
  value: 0.05,
  unit: 'percent',
  sourceTimestamp: new Date().toISOString(),
  ingestedAt: new Date().toISOString(),
  ...overrides,
});

describe('validateSamples', () => {
  it('throws when HY <= IG', () => {
    const hy = baseSample();
    const ig: MetricSample = { ...baseSample({ id: 'igOas', label: 'IG OAS', value: 0.06, unit: 'percent' }) };
    expect(() => validateSamples([hy, ig])).toThrow();
  });

  it('allows valid ranges', () => {
    const hy = baseSample({ value: 0.07 });
    const ig: MetricSample = { ...baseSample({ id: 'igOas', label: 'IG OAS', value: 0.02, unit: 'percent' }) };
    expect(() => validateSamples([hy, ig])).not.toThrow();
  });
});
