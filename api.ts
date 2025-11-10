export type MetricState = 'Stress' | 'Caution' | 'Stable' | 'PAMP';

export interface MetricRow {
  id: string;
  label: string;
  value: number;
  delta: number;
  lower: number;
  upper: number;
  zScore: number;
  contribution: number;
  breach: MetricState;
}

export interface PXIResponse {
  pxi: number;
  statusLabel: string;
  zScore: number;
  calculatedAt: string;
  metrics: MetricRow[];
  ticker: string[];
}

export const classifyMetricState = (zScore: number): MetricState => {
  if (zScore >= 2) return 'PAMP';
  if (zScore <= -2) return 'Stress';
  if (Math.abs(zScore) >= 1) return 'Caution';
  return 'Stable';
};
