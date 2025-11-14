import { pxiBands, pxiMetricDefinitions, classifyMetricState } from './shared/pxiMetrics.js';
import type { MetricId } from './shared/types.js';

export interface ComputePXIMetricInput {
  id: MetricId;
  value: number;
  zScore?: number | null;
  weightOverride?: number;
}

export interface ComputePXIMetricResult {
  id: MetricId;
  value: number;
  weight: number;
  normalizedScore: number;
  contribution: number;
  zScore: number;
  state: 'Stress' | 'Caution' | 'Stable' | 'PAMP';
}

export interface ComputePXIOptions {
  maxMetricContribution?: number;
}

export interface ComputePXIResult {
  pxi: number;
  zScore: number;
  regime: string;
  systemBreach: 'Stress' | 'Caution' | null;
  metrics: ComputePXIMetricResult[];
}

const DEFAULT_MAX_CONTRIBUTION = 0.25;
const DEF_MAP = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const logistic = (value: number): number => 1 / (1 + Math.exp(-value));
const clampZ = (value: number): number => clamp(value, -6, 6);

const normalizedFromBounds = (
  value: number,
  polarity: 'positive' | 'negative',
  lower: number,
  upper: number,
): number => {
  const range = upper - lower || 1;
  const ratio = (value - lower) / range;
  const clampedRatio = clamp(ratio, 0, 1);
  return polarity === 'positive' ? clampedRatio : 1 - clampedRatio;
};

const normalizedFromZScore = (
  z: number,
  polarity: 'positive' | 'negative',
): { normalized: number; adjustedZ: number } => {
  const adjustedZ = polarity === 'negative' ? -z : z;
  const normalized = logistic(clampZ(adjustedZ));
  return { normalized, adjustedZ };
};

const determineBand = (pxi: number): string => {
  const match = pxiBands.find((band) => pxi >= band.min && pxi < band.max);
  return match ? match.label : (pxi >= 100 ? 'PAMP' : 'Stress');
};

export function computePXI(
  metrics: ComputePXIMetricInput[],
  options: ComputePXIOptions = {},
): ComputePXIResult {
  const maxContributionShare = options.maxMetricContribution ?? DEFAULT_MAX_CONTRIBUTION;
  const metricResults: ComputePXIMetricResult[] = [];

  for (const metric of metrics) {
    const def = DEF_MAP.get(metric.id);
    if (!def) continue;

    const weight = metric.weightOverride ?? def.weight;
    const hasZScore = metric.zScore !== undefined && metric.zScore !== null && Number.isFinite(metric.zScore);

    let normalizedScore: number;
    let riskAdjustedZ: number;

    if (hasZScore) {
      const result = normalizedFromZScore(metric.zScore as number, def.polarity);
      normalizedScore = result.normalized;
      riskAdjustedZ = result.adjustedZ;
    } else {
      normalizedScore = normalizedFromBounds(metric.value, def.polarity, def.lowerBound, def.upperBound);
      riskAdjustedZ = (normalizedScore - 0.5) * 6;
    }

    metricResults.push({
      id: metric.id,
      value: metric.value,
      weight,
      normalizedScore,
      contribution: normalizedScore * weight,
      zScore: riskAdjustedZ,
      state: classifyMetricState(riskAdjustedZ),
    });
  }

  const totalWeight = metricResults.reduce((sum, metric) => sum + Math.max(metric.weight, 0), 0);
  if (totalWeight === 0) {
    return {
      pxi: 0,
      zScore: -3,
      regime: 'Stress',
      systemBreach: 'Stress',
      metrics: [],
    };
  }

  const maxContribution = totalWeight * maxContributionShare;
  const weightedSum = metricResults.reduce((sum, metric) => {
    if (metric.weight <= 0) return sum;
    const capped = Math.min(metric.contribution, maxContribution);
    return sum + capped;
  }, 0);

  const pxi = clamp((weightedSum / totalWeight) * 100, 0, 100);
  const regime = determineBand(pxi);
  const zScore = (pxi / 100 - 0.5) * 6;
  const systemBreach = regime === 'Stress' ? 'Stress' : regime === 'Caution' ? 'Caution' : null;

  return {
    pxi,
    zScore,
    regime,
    systemBreach,
    metrics: metricResults,
  };
}
