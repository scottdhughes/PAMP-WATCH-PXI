/**
 * PXI Metrics Configuration
 *
 * Defines the bounds, weights, and polarity for each metric in the PXI composite
 */

import { PXIMetricDefinition, PXIBand } from './types.js';

/**
 * Metric definitions with bounds, weights, and risk direction
 */
export const pxiMetricDefinitions: PXIMetricDefinition[] = [
  {
    id: 'hyOas',
    label: 'HY OAS',
    lowerBound: 0.03,
    upperBound: 0.08,
    weight: 1.5,
    polarity: 'negative',
    riskDirection: 'higher_is_more_risk',
    seriesId: 'BAMLH0A0HYM2',
    source: 'FRED',
  },
  {
    id: 'igOas',
    label: 'IG OAS',
    lowerBound: 0.01,
    upperBound: 0.03,
    weight: 1.2,
    polarity: 'negative',
    riskDirection: 'higher_is_more_risk',
    seriesId: 'BAMLC0A4CBBB',
    source: 'FRED',
  },
  {
    id: 'vix',
    label: 'VIX Index',
    lowerBound: 12,
    upperBound: 25,
    weight: 1.8,
    polarity: 'negative',
    riskDirection: 'higher_is_more_risk',
    seriesId: 'VIXCLS',
    source: 'FRED',
  },
  {
    id: 'u3',
    label: 'U-3 Unemployment',
    lowerBound: 0.035,
    upperBound: 0.06,
    weight: 1.0,
    polarity: 'negative',
    riskDirection: 'higher_is_more_risk',
    seriesId: 'UNRATE',
    source: 'FRED',
  },
  {
    id: 'usd',
    label: 'USD Index (Broad)',
    lowerBound: 100,
    upperBound: 130,
    weight: 0.8,
    polarity: 'positive',
    riskDirection: 'higher_is_less_risk',
    seriesId: 'DTWEXBGS',
    source: 'FRED',
  },
  {
    id: 'nfci',
    label: 'Chicago Fed NFCI',
    lowerBound: -0.5,
    upperBound: 0.5,
    weight: 1.3,
    polarity: 'negative',
    riskDirection: 'higher_is_more_risk',
    seriesId: 'NFCI',
    source: 'FRED',
  },
  {
    id: 'btcReturn',
    label: 'BTC Daily Return',
    lowerBound: -0.05,
    upperBound: 0.05,
    weight: 1.0,
    polarity: 'positive',
    riskDirection: 'higher_is_less_risk',
    seriesId: 'bitcoin',
    source: 'CoinGecko',
  },
];

/**
 * PXI bands for classification
 */
export const pxiBands: PXIBand[] = [
  { label: 'Stress', min: 0, max: 30, color: 'from-pampRed/80 to-pampRed/40' },
  { label: 'Caution', min: 30, max: 50, color: 'from-pampAmber/80 to-pampAmber/40' },
  { label: 'Stable', min: 50, max: 75, color: 'from-pampGreen/80 to-pampGreen/40' },
  { label: 'PAMP', min: 75, max: 100, color: 'from-violet/80 to-violet/40' },
];

/**
 * Classify metric state based on z-score
 */
export function classifyMetricState(zScore: number): 'Stress' | 'Caution' | 'Stable' | 'PAMP' {
  if (zScore < -2) return 'Stress';
  if (zScore < -1) return 'Caution';
  if (zScore > 2) return 'PAMP';
  return 'Stable';
}
