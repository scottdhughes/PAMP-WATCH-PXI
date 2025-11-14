import { describe, expect, it } from 'vitest';
import { computePXI } from './computePXI.ts';
const inputs = [
    { id: 'hyOas', value: 0.04 },
    { id: 'igOas', value: 0.02 },
    { id: 'vix', value: 20 },
    { id: 'u3', value: 0.045 },
    { id: 'usd', value: 100 },
    { id: 'nfci', value: 0.1 },
    { id: 'btcReturn', value: 0.01 },
];
describe('computePXI', () => {
    it('maps z-score to 0-100 range', () => {
        const result = computePXI(inputs);
        expect(result.pxi).toBeGreaterThanOrEqual(0);
        expect(result.pxi).toBeLessThanOrEqual(100);
    });
    it('flags system breach when anchors align', () => {
        const stressInputs = inputs.map((metric) => metric.id === 'hyOas' || metric.id === 'igOas' || metric.id === 'nfci'
            ? { ...metric, value: metric.value + 0.1 }
            : metric);
        const result = computePXI(stressInputs);
        expect(result.systemBreach).toBe('Stress');
    });
});
