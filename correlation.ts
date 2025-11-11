/**
 * PXI Correlation & Structural Shift Detection
 *
 * Analyzes inter-metric correlations to detect:
 * - Regime changes (correlation structure shifts)
 * - Anomalous co-movements (e.g., BTC correlating with credit spreads)
 * - Contribution drift (metrics becoming more/less influential)
 */

import { sampleCorrelation } from 'simple-statistics';
import { logger } from './logger.js';

export interface CorrelationMatrix {
  [metricId: string]: {
    [metricId: string]: number;
  };
}

export interface CorrelationShift {
  metric1: string;
  metric2: string;
  currentCorr: number;
  historicalCorr: number;
  delta: number;
  isSignificant: boolean;
}

/**
 * Compute correlation matrix for all metric pairs
 *
 * @param metrics - Map of metric IDs to time series (must be equal length)
 * @returns Correlation matrix with all pairwise correlations
 */
export function correlationMatrix(metrics: Record<string, number[]>): CorrelationMatrix {
  const names = Object.keys(metrics);
  const matrix: CorrelationMatrix = {};

  // Validate that all series have the same length
  const lengths = Object.values(metrics).map((series) => series.length);
  const minLength = Math.min(...lengths);

  if (minLength < 2) {
    logger.warn('Insufficient data for correlation matrix (need at least 2 observations)');
    return {};
  }

  // Truncate all series to minimum length to ensure alignment
  const alignedMetrics: Record<string, number[]> = {};
  for (const [id, series] of Object.entries(metrics)) {
    alignedMetrics[id] = series.slice(-minLength);
  }

  // Compute pairwise correlations
  for (let i = 0; i < names.length; i++) {
    matrix[names[i]] = {};
    for (let j = 0; j < names.length; j++) {
      if (i === j) {
        matrix[names[i]][names[j]] = 1.0; // Perfect correlation with self
      } else {
        try {
          const corr = sampleCorrelation(
            alignedMetrics[names[i]],
            alignedMetrics[names[j]]
          );
          matrix[names[i]][names[j]] = Number.isFinite(corr) ? corr : 0;
        } catch (error) {
          logger.warn({ metric1: names[i], metric2: names[j], error }, 'Correlation calculation failed');
          matrix[names[i]][names[j]] = 0;
        }
      }
    }
  }

  return matrix;
}

/**
 * Detect significant shifts in correlation structure
 *
 * @param currentMatrix - Current correlation matrix
 * @param historicalMatrix - Historical correlation matrix (e.g., from 90 days ago)
 * @param threshold - Minimum absolute change to flag as significant (default: 0.3)
 * @returns Array of correlation shifts exceeding threshold
 */
export function detectCorrelationShifts(
  currentMatrix: CorrelationMatrix,
  historicalMatrix: CorrelationMatrix,
  threshold = 0.3
): CorrelationShift[] {
  const shifts: CorrelationShift[] = [];

  for (const metric1 of Object.keys(currentMatrix)) {
    for (const metric2 of Object.keys(currentMatrix[metric1])) {
      // Skip self-correlation and duplicate pairs
      if (metric1 >= metric2) continue;

      const currentCorr = currentMatrix[metric1]?.[metric2] ?? 0;
      const historicalCorr = historicalMatrix[metric1]?.[metric2] ?? 0;
      const delta = currentCorr - historicalCorr;

      const isSignificant = Math.abs(delta) >= threshold;

      if (isSignificant) {
        shifts.push({
          metric1,
          metric2,
          currentCorr,
          historicalCorr,
          delta,
          isSignificant,
        });

        logger.info(
          {
            metric1,
            metric2,
            currentCorr: currentCorr.toFixed(3),
            historicalCorr: historicalCorr.toFixed(3),
            delta: delta.toFixed(3),
          },
          'Significant correlation shift detected'
        );
      }
    }
  }

  return shifts;
}

/**
 * Find anomalous correlations (pairs that shouldn't correlate but do)
 *
 * @param matrix - Correlation matrix
 * @param anomalousP pairs - List of [metric1, metric2] pairs that are anomalous if highly correlated
 * @param threshold - Correlation threshold for anomaly (default: 0.6)
 * @returns Array of anomalous correlations
 */
export function findAnomalousCorrelations(
  matrix: CorrelationMatrix,
  anomalousPairs: Array<[string, string]>,
  threshold = 0.6
): Array<{ metric1: string; metric2: string; correlation: number }> {
  const anomalies: Array<{ metric1: string; metric2: string; correlation: number }> = [];

  for (const [metric1, metric2] of anomalousPairs) {
    const corr = Math.abs(matrix[metric1]?.[metric2] ?? 0);

    if (corr >= threshold) {
      anomalies.push({
        metric1,
        metric2,
        correlation: matrix[metric1][metric2],
      });

      logger.warn(
        {
          metric1,
          metric2,
          correlation: corr.toFixed(3),
        },
        'Anomalous correlation detected'
      );
    }
  }

  return anomalies;
}

/**
 * Calculate average absolute correlation with other metrics (diversification measure)
 *
 * @param matrix - Correlation matrix
 * @param metricId - Metric to analyze
 * @returns Average absolute correlation with all other metrics
 */
export function averageCorrelation(matrix: CorrelationMatrix, metricId: string): number {
  const correlations = Object.entries(matrix[metricId] || {})
    .filter(([otherId]) => otherId !== metricId)
    .map(([, corr]) => Math.abs(corr));

  if (correlations.length === 0) return 0;

  return correlations.reduce((sum, corr) => sum + corr, 0) / correlations.length;
}

/**
 * Rank metrics by their average correlation (lower = more diversifying)
 *
 * @param matrix - Correlation matrix
 * @returns Sorted array of [metricId, avgCorr] pairs
 */
export function rankMetricsByDiversification(
  matrix: CorrelationMatrix
): Array<[string, number]> {
  const rankings: Array<[string, number]> = [];

  for (const metricId of Object.keys(matrix)) {
    rankings.push([metricId, averageCorrelation(matrix, metricId)]);
  }

  // Sort by average correlation (ascending = more diversifying)
  return rankings.sort((a, b) => a[1] - b[1]);
}

/**
 * Export correlation matrix as CSV string for analysis
 *
 * @param matrix - Correlation matrix
 * @returns CSV string
 */
export function exportCorrelationMatrixCSV(matrix: CorrelationMatrix): string {
  const metricIds = Object.keys(matrix);
  if (metricIds.length === 0) return '';

  // Header row
  let csv = 'Metric,' + metricIds.join(',') + '\n';

  // Data rows
  for (const metric1 of metricIds) {
    const row = [metric1];
    for (const metric2 of metricIds) {
      row.push((matrix[metric1][metric2] || 0).toFixed(4));
    }
    csv += row.join(',') + '\n';
  }

  return csv;
}
