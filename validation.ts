/**
 * PXI Quantitative Validation Layer
 *
 * Performs statistical sanity checks on metric time series to detect:
 * - Outliers (>3σ deviations)
 * - Flatline data (zero variance)
 * - Invalid values (NaN, Infinity)
 * - Insufficient data
 */

import { mean, std } from 'mathjs';
import { logger } from './logger.js';

export interface SanityCheckResult {
  ok: boolean;
  label: string;
  z: number | null;
  σ: number | null;
  μ: number | null;
  latest: number | null;
  isOutlier: boolean;
  isFlat: boolean;
  isInvalid: boolean;
  reason: string;
}

/**
 * Performs statistical sanity check on a time series
 *
 * @param series - Array of values (oldest to newest)
 * @param label - Metric identifier for logging
 * @param outlierThreshold - Z-score threshold for outlier detection (default: 3)
 * @param minDataPoints - Minimum required data points (default: 5)
 * @returns Sanity check result with validation status
 */
export function sanityCheck(
  series: number[],
  label: string,
  outlierThreshold = 3,
  minDataPoints = 5
): SanityCheckResult {
  // Check for insufficient data
  if (!series || series.length < minDataPoints) {
    return {
      ok: false,
      label,
      z: null,
      σ: null,
      μ: null,
      latest: null,
      isOutlier: false,
      isFlat: false,
      isInvalid: false,
      reason: `Insufficient data (${series?.length || 0} < ${minDataPoints})`,
    };
  }

  const latest = series[series.length - 1];

  // Check for invalid values
  if (!Number.isFinite(latest)) {
    return {
      ok: false,
      label,
      z: null,
      σ: null,
      μ: null,
      latest,
      isOutlier: false,
      isFlat: false,
      isInvalid: true,
      reason: `Invalid value: ${latest}`,
    };
  }

  // Calculate statistics
  const μ = mean(series) as number;
  const σ = std(series, 'unbiased') as number;

  // Check for flatline (zero variance)
  const isFlat = σ < 1e-9;
  if (isFlat) {
    return {
      ok: false,
      label,
      z: 0,
      σ,
      μ,
      latest,
      isOutlier: false,
      isFlat: true,
      isInvalid: false,
      reason: 'Flatline data (zero variance)',
    };
  }

  // Calculate z-score relative to rolling window
  const z = (latest - μ) / σ;

  // Check for outliers
  const isOutlier = Math.abs(z) > outlierThreshold;

  if (isOutlier) {
    logger.warn(
      { label, latest, μ, σ, z, threshold: outlierThreshold },
      'Outlier detected in metric'
    );
  }

  return {
    ok: !isOutlier && !isFlat && Number.isFinite(latest),
    label,
    z,
    σ,
    μ,
    latest,
    isOutlier,
    isFlat,
    isInvalid: false,
    reason: isOutlier ? `Outlier (z=${z.toFixed(2)}, >${outlierThreshold}σ)` : 'OK',
  };
}

/**
 * Calculate rolling volatility (coefficient of variation)
 *
 * @param series - Array of values
 * @param window - Rolling window size (default: 30)
 * @returns Volatility as percentage (σ/μ * 100) or null if insufficient data
 */
export function rollingVolatility(series: number[], window = 30): number | null {
  if (!series || series.length < window) {
    return null;
  }

  const slice = series.slice(-window);
  const μ = mean(slice) as number;
  const σ = std(slice, 'unbiased') as number;

  // Coefficient of variation (CV) as percentage
  if (μ === 0) return null;

  return (σ / Math.abs(μ)) * 100;
}

/**
 * Calculate stability score based on recent volatility
 * Returns rating: "Stable", "Moderate", "Volatile", "Extreme"
 *
 * @param volatility - Rolling volatility percentage
 * @returns Stability rating
 */
export function stabilityRating(volatility: number | null): string {
  if (volatility === null) return 'Unknown';
  if (volatility < 5) return 'Stable';
  if (volatility < 15) return 'Moderate';
  if (volatility < 30) return 'Volatile';
  return 'Extreme';
}

/**
 * Batch validation for multiple metrics
 *
 * @param metrics - Map of metric IDs to time series
 * @param outlierThreshold - Z-score threshold
 * @returns Map of metric IDs to validation results
 */
export function validateMetrics(
  metrics: Record<string, number[]>,
  outlierThreshold = 3
): Record<string, SanityCheckResult> {
  const results: Record<string, SanityCheckResult> = {};

  for (const [id, series] of Object.entries(metrics)) {
    results[id] = sanityCheck(series, id, outlierThreshold);
  }

  return results;
}

/**
 * Summarize validation diagnostics
 *
 * @param results - Array of validation results
 * @returns Summary with counts and failed metrics
 */
export function summarizeDiagnostics(results: SanityCheckResult[]): {
  total: number;
  ok: number;
  outliers: number;
  flatlines: number;
  invalid: number;
  broken: SanityCheckResult[];
} {
  const broken = results.filter((r) => !r.ok);

  if (broken.length > 0) {
    logger.warn(
      {
        broken: broken.map((b) => ({
          label: b.label,
          reason: b.reason,
          latest: b.latest,
        })),
      },
      'PXI validation anomalies detected'
    );
  }

  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    outliers: results.filter((r) => r.isOutlier).length,
    flatlines: results.filter((r) => r.isFlat).length,
    invalid: results.filter((r) => r.isInvalid).length,
    broken,
  };
}
