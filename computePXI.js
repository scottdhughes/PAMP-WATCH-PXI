import { clamp, pxiMetricDefinitions } from '@pxi/shared';
const anchorSet = new Set(['hyOas', 'igOas', 'usd', 'nfci']);
export const computePXI = (inputs) => {
    const defMap = new Map(pxiMetricDefinitions.map((definition) => [definition.id, definition]));
    const computations = [];
    inputs.forEach((input) => {
        const definition = defMap.get(input.id);
        if (!definition)
            return;
        const m = (definition.lowerBound + definition.upperBound) / 2;
        const r = (definition.upperBound - definition.lowerBound) / 2;
        const normalized = (input.value - m) / r;
        const zScore = definition.polarity * clamp(normalized, -3, 3);
        const contribution = definition.weight * zScore;
        let breach = null;
        if (zScore >= 2)
            breach = 'PAMP';
        if (zScore <= -2)
            breach = 'Stress';
        computations.push({
            id: input.id,
            value: input.value,
            definition,
            zScore,
            contribution,
            breach,
        });
    });
    const weightSum = computations.reduce((sum, metric) => sum + metric.definition.weight, 0);
    const contributionSum = computations.reduce((sum, metric) => sum + metric.contribution, 0);
    const zScore = contributionSum / weightSum;
    const pxi = 100 * (zScore + 3) / 6;
    const pampBreaches = computations.filter((metric) => metric.breach === 'PAMP').map((m) => m.id);
    const stressBreaches = computations.filter((metric) => metric.breach === 'Stress').map((m) => m.id);
    const qualifies = (breaches) => {
        if (breaches.length < 3)
            return false;
        return breaches.some((breach) => anchorSet.has(breach));
    };
    let systemBreach = null;
    if (qualifies(pampBreaches))
        systemBreach = 'PAMP';
    if (qualifies(stressBreaches))
        systemBreach = 'Stress';
    return { metrics: computations, zScore, pxi, systemBreach };
};
