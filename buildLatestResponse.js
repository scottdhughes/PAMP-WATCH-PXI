import { fetchLatestComposites } from '../db.js';
import { classifyMetricState, pxiBands, pxiMetricDefinitions, } from '@pxi/shared';
const definitionMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));
export const buildLatestResponse = async () => {
    const [latest, previous] = await fetchLatestComposites(2);
    if (!latest) {
        return null;
    }
    const prevMap = new Map(previous?.metrics?.map((metric) => [metric.id, metric]) ?? []);
    const metrics = latest.metrics.map((metric) => {
        const def = definitionMap.get(metric.id);
        if (!def) {
            throw new Error(`Missing definition for metric ${metric.id}`);
        }
        const prev = prevMap.get(metric.id);
        const delta = prev ? metric.value - prev.value : 0;
        const breach = classifyMetricState(metric.zScore);
        return {
            id: metric.id,
            label: def.label,
            value: metric.value,
            delta,
            lower: def.lowerBound,
            upper: def.upperBound,
            zScore: metric.zScore,
            contribution: metric.contribution,
            breach,
        };
    });
    const band = pxiBands.find((candidate) => latest.pxi >= candidate.min && latest.pxi < candidate.max) ??
        pxiBands[pxiBands.length - 1];
    const ticker = [
        ...latest.breaches.pamp.map((id) => `${definitionMap.get(id)?.label ?? id} - PAMP`),
        ...latest.breaches.stress.map((id) => `${definitionMap.get(id)?.label ?? id} - Stress`),
    ];
    if (latest.breaches.systemLevel) {
        ticker.push(`System Breach - ${latest.breaches.systemLevel}`);
    }
    const response = {
        pxi: latest.pxi,
        statusLabel: `${band.label} - ${latest.pxi.toFixed(1)}`,
        zScore: latest.zScore,
        calculatedAt: latest.calculatedAt,
        metrics,
        ticker,
    };
    return response;
};
