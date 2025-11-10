import { describe, expect, it } from 'vitest';
import { validateSamples } from './validator.js';
const baseSample = (overrides = {}) => ({
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
        const ig = { ...baseSample({ id: 'igOas', label: 'IG OAS', value: 0.06, unit: 'percent' }) };
        expect(() => validateSamples([hy, ig])).toThrow();
    });
    it('allows valid ranges', () => {
        const hy = baseSample({ value: 0.07 });
        const ig = { ...baseSample({ id: 'igOas', label: 'IG OAS', value: 0.02, unit: 'percent' }) };
        expect(() => validateSamples([hy, ig])).not.toThrow();
    });
});
