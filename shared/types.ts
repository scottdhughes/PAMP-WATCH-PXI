/**
 * Core type definitions for the PXI platform
 */

/**
 * Metric ID type - ensures type safety for metric identifiers
 */
export type MetricId = 'hyOas' | 'igOas' | 'vix' | 'u3' | 'usd' | 'nfci' | 'btcReturn';

/**
 * Breach status type
 */
export type BreachStatus = 'Stress' | 'Caution' | 'Stable' | 'PAMP' | null;

/**
 * Sample data from external API sources
 */
export interface MetricSample {
  id: MetricId;
  label: string;
  value: number;
  unit: string;
  sourceTimestamp: string;
  ingestedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Risk direction type
 */
export type RiskDirection = 'higher_is_more_risk' | 'higher_is_less_risk';

/**
 * Metric definition with bounds and weights
 */
export interface PXIMetricDefinition {
  id: MetricId;
  label: string;
  lowerBound: number;
  upperBound: number;
  weight: number;
  polarity: 'positive' | 'negative';
  riskDirection: RiskDirection;
  seriesId: string;
  source: 'FRED' | 'CoinGecko' | 'AlphaVantage' | 'TwelveData';
}

/**
 * Health status type for validation
 */
export type HealthStatus = 'OK' | 'Outlier' | 'Flat' | 'Invalid' | 'Stale';

/**
 * Metric row in API response
 */
export interface MetricRow {
  id: MetricId;
  label: string;
  value: number;
  delta: number;  // Deprecated: use delta7D or delta30D
  delta7D?: number;  // 7-day percentage change
  delta30D?: number; // 30-day percentage change
  lower: number;
  upper: number;
  zScore: number;
  contribution: number;
  breach: BreachStatus;
  health?: HealthStatus;  // Data quality status
  volatility?: number;     // Rolling volatility (%)
  stability?: string;      // Stability rating
}

/**
 * PXI band definition
 */
export interface PXIBand {
  label: string;
  min: number;
  max: number;
  color: string;
}

/**
 * Breach information
 */
export interface BreachInfo {
  pamp: MetricId[];
  stress: MetricId[];
  systemLevel: string | null;
}

/**
 * Alert record from API
 */
export interface Alert {
  id: number;
  alertType: string;
  indicatorId: string | null;
  timestamp: string;
  rawValue: number | null;
  zScore: number | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Regime information
 */
export interface Regime {
  regime: string;
  pxiValue: number;
  totalWeight: number;
  pampCount: number;
  stressCount: number;
}

/**
 * Complete PXI API response
 */
export interface PXIResponse {
  pxi: number;
  statusLabel: string;
  zScore: number;
  calculatedAt: string;
  metrics: MetricRow[];
  ticker: string[];
  alerts?: Alert[];
  regime?: Regime;
}

/**
 * Database composite record
 */
export interface CompositeRecord {
  id: number;
  calculatedAt: string;
  zScore: number;
  pxi: number;
  metrics: Array<{
    id: MetricId;
    value: number;
    zScore: number;
    contribution: number;
  }>;
  breaches: BreachInfo;
}

/**
 * Fetcher function type
 */
export interface MetricFetcher {
  id: MetricId;
  label: string;
  fetch: () => Promise<MetricSample>;
}
