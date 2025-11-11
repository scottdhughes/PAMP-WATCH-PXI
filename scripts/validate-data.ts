/**
 * PXI Data Validation Script
 *
 * Runs automated quantitative diagnostics on metric data:
 * - Statistical sanity checks (outliers, flatlines, invalid values)
 * - Rolling volatility analysis
 * - Correlation matrix and structural shift detection
 *
 * Usage: npm run validate:data
 */

import { pool } from '../db.js';
import { sanityCheck, rollingVolatility, stabilityRating, summarizeDiagnostics, type SanityCheckResult } from '../validation.js';
import { correlationMatrix, detectCorrelationShifts, findAnomalousCorrelations, rankMetricsByDiversification, exportCorrelationMatrixCSV } from '../correlation.js';
import { pxiMetricDefinitions } from '../shared/index.js';
import { logger } from '../logger.js';
import type { PoolClient } from 'pg';

const LOOKBACK_DAYS = 90;
const CORRELATION_WINDOW = 30; // Use last 30 days for correlation

interface MetricSeries {
  metricId: string;
  values: number[];
  timestamps: Date[];
}

/**
 * Fetch time series for a metric
 */
async function fetchMetricSeries(
  metricId: string,
  daysAgo: number
): Promise<MetricSeries> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT value, source_timestamp
       FROM pxi_metric_samples
       WHERE metric_id = $1
         AND source_timestamp >= NOW() - INTERVAL '${daysAgo} days'
       ORDER BY source_timestamp ASC`,
      [metricId]
    );

    return {
      metricId,
      values: result.rows.map((r) => r.value),
      timestamps: result.rows.map((r) => r.source_timestamp),
    };
  } catch (error) {
    logger.error({ error, metricId }, 'Failed to fetch metric series');
    return { metricId, values: [], timestamps: [] };
  } finally {
    if (client) client.release();
  }
}

/**
 * Main validation routine
 */
async function runValidation() {
  logger.info('🔍 Starting PXI data validation...');

  // 1. Fetch all metric time series
  const metricIds = pxiMetricDefinitions.map((def) => def.id);
  const seriesData: Record<string, number[]> = {};
  const fullSeries: MetricSeries[] = [];

  logger.info({ metricCount: metricIds.length, lookbackDays: LOOKBACK_DAYS }, 'Fetching metric data');

  for (const metricId of metricIds) {
    const series = await fetchMetricSeries(metricId, LOOKBACK_DAYS);
    seriesData[metricId] = series.values;
    fullSeries.push(series);
    logger.debug({ metricId, dataPoints: series.values.length }, 'Fetched metric series');
  }

  // 2. Run sanity checks on each metric
  logger.info('📊 Running sanity checks...');
  const sanityResults: SanityCheckResult[] = [];

  for (const [metricId, values] of Object.entries(seriesData)) {
    const result = sanityCheck(values, metricId);
    sanityResults.push(result);

    const def = pxiMetricDefinitions.find((d) => d.id === metricId);
    const volatility = rollingVolatility(values, 30);
    const stability = stabilityRating(volatility);

    logger.info(
      {
        metricId,
        label: def?.label,
        ok: result.ok,
        latest: result.latest,
        μ: result.μ?.toFixed(4),
        σ: result.σ?.toFixed(4),
        z: result.z?.toFixed(2),
        volatility: volatility?.toFixed(2),
        stability,
        reason: result.reason,
      },
      result.ok ? 'Metric validation passed' : 'Metric validation FAILED'
    );
  }

  // 3. Summarize diagnostics
  const summary = summarizeDiagnostics(sanityResults);
  logger.info(
    {
      total: summary.total,
      ok: summary.ok,
      outliers: summary.outliers,
      flatlines: summary.flatlines,
      invalid: summary.invalid,
    },
    'Validation summary'
  );

  if (summary.broken.length > 0) {
    logger.warn(
      {
        brokenMetrics: summary.broken.map((b) => ({
          id: b.label,
          reason: b.reason,
          latest: b.latest,
          z: b.z,
        })),
      },
      '⚠️  Anomalies detected'
    );
  }

  // 4. Calculate correlation matrix (using last 30 days for recent relationships)
  logger.info('🔗 Computing correlation matrix...');
  const recentSeriesData: Record<string, number[]> = {};
  for (const [metricId, values] of Object.entries(seriesData)) {
    recentSeriesData[metricId] = values.slice(-CORRELATION_WINDOW);
  }

  const corrMatrix = correlationMatrix(recentSeriesData);

  if (Object.keys(corrMatrix).length > 0) {
    // Log correlation matrix
    logger.info('Correlation matrix computed');
    logger.debug({ matrix: corrMatrix }, 'Full correlation matrix');

    // 5. Rank metrics by diversification
    const diversificationRanking = rankMetricsByDiversification(corrMatrix);
    logger.info(
      {
        rankings: diversificationRanking.map(([id, avgCorr]) => ({
          metric: id,
          avgCorrelation: avgCorr.toFixed(3),
        })),
      },
      'Diversification rankings (lower = more diversifying)'
    );

    // 6. Check for anomalous correlations
    // These pairs should NOT be highly correlated under normal conditions
    const anomalousPairs: Array<[string, string]> = [
      ['btcReturn', 'hyOas'], // Crypto vs credit spreads
      ['btcReturn', 'igOas'], // Crypto vs IG spreads
      ['vix', 'nfci'],        // VIX vs NFCI (should be loosely correlated)
    ];

    const anomalies = findAnomalousCorrelations(corrMatrix, anomalousPairs, 0.6);
    if (anomalies.length > 0) {
      logger.warn(
        {
          anomalies: anomalies.map((a) => ({
            pair: `${a.metric1} - ${a.metric2}`,
            correlation: a.correlation.toFixed(3),
          })),
        },
        '⚠️  Anomalous correlations detected'
      );
    }

    // 7. Export correlation matrix as CSV (optional)
    const csv = exportCorrelationMatrixCSV(corrMatrix);
    logger.debug({ csv }, 'Correlation matrix CSV');
  } else {
    logger.warn('Insufficient data for correlation matrix');
  }

  // 8. Final summary
  logger.info(
    {
      metricsValidated: summary.total,
      passed: summary.ok,
      failed: summary.total - summary.ok,
      status: summary.ok === summary.total ? 'PASS' : 'FAIL',
    },
    '✅ Validation complete'
  );

  // Exit with error code if any checks failed
  if (summary.ok < summary.total) {
    process.exit(1);
  }
}

// Run validation
runValidation()
  .catch((error) => {
    logger.error({ error }, 'Validation script failed');
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
