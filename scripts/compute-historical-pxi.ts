#!/usr/bin/env node
/**
 * Compute Historical Composite PXI
 *
 * Takes historical metrics and BTC data and computes composite PXI
 * values for the past 30 days, populating the composite_pxi_regime table.
 */

import { pool } from '../db.js';
import { logger } from '../logger.js';
import { computePXI } from '../computePXI';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';

interface HistoricalMetric {
  date: string;
  indicatorId: string;
  value: number | null;
  mean: number | null;
  stddev: number | null;
}

/**
 * Get all dates that have complete metric data
 */
async function getAvailableDates(daysBack: number = 30): Promise<string[]> {
  const result = await pool.query<{ date: string }>(
    `SELECT DISTINCT date
     FROM history_values
     WHERE date >= NOW() - INTERVAL '${daysBack} days'
     ORDER BY date DESC`,
  );
  return result.rows.map((r) => {
    const iso = (r.date instanceof Date ? r.date : new Date(r.date)).toISOString();
    return iso.split('T')[0];
  });
}

/**
 * Get metrics for a specific date
 */
async function getMetricsForDate(date: string): Promise<Record<string, HistoricalMetric>> {
  const result = await pool.query<HistoricalMetric>(
    `SELECT
        hv.indicator_id AS "indicatorId",
        hv.date,
        hv.raw_value AS value,
        stats.mean_value AS mean,
        stats.stddev_value AS stddev
     FROM history_values hv
     LEFT JOIN LATERAL (
       SELECT mean_value, stddev_value
       FROM stats_values sv
       WHERE sv.indicator_id = hv.indicator_id
         AND sv.date <= hv.date
       ORDER BY sv.date DESC
       LIMIT 1
     ) stats ON TRUE
     WHERE hv.date = $1`,
    [date]
  );

  const metrics: Record<string, HistoricalMetric> = {};
  for (const row of result.rows) {
    metrics[row.indicatorId] = row;
  }

  return metrics;
}

/**
 * Insert computed PXI into database
 */
async function insertHistoricalPXI(
  timestamp: Date,
  pxiValue: number,
  pxiZScore: number,
  regime: string,
  totalWeight: number,
  pampCount: number,
  stressCount: number,
  metadata: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO composite_pxi_regime (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (timestamp) DO UPDATE
     SET pxi_value = EXCLUDED.pxi_value,
         pxi_z_score = EXCLUDED.pxi_z_score,
         regime = EXCLUDED.regime,
         total_weight = EXCLUDED.total_weight,
         pamp_count = EXCLUDED.pamp_count,
         stress_count = EXCLUDED.stress_count,
         metadata = EXCLUDED.metadata`,
    [timestamp, pxiValue, pxiZScore, regime, totalWeight, pampCount, stressCount, JSON.stringify(metadata)]
  );
}

/**
 * Main computation function
 */
async function computeHistoricalPXI(): Promise<void> {
  logger.info('Starting historical PXI computation');

  try {
    // Get all dates with data
    const dates = await getAvailableDates(30);
    logger.info({ count: dates.length }, 'Found dates with metric data');

    if (dates.length === 0) {
      logger.warn('No historical data found');
      return;
    }

    let processed = 0;
    let errors = 0;

    for (const date of dates) {
      try {
        // Get all metrics for this date
        const metrics = await getMetricsForDate(date);

        // Check if we have all required metrics
        const requiredMetrics = pxiMetricDefinitions.map((def) => def.id);
        const missingMetrics = requiredMetrics.filter(id => !metrics[id]);

        if (missingMetrics.length > 0) {
          logger.debug({ date, missingMetrics }, 'Skipping date with missing metrics');
          continue;
        }

        // Prepare metrics in the format expected by computePXI
        const metricSamples = requiredMetrics.map(id => {
          const metric = metrics[id];

          // Calculate z-score
          let zScore = 0;
          if (metric.mean !== null && metric.stddev !== null && metric.stddev > 0) {
            zScore = (metric.value! - metric.mean) / metric.stddev;
          }

          return {
            id,
            label: id,
            value: metric.value!,
            unit: 'value',
            sourceTimestamp: date,
            ingestedAt: new Date().toISOString(),
            lower: metric.mean! - 2 * metric.stddev!,
            upper: metric.mean! + 2 * metric.stddev!,
            zScore,
            contribution: zScore, // Will be recalculated by computePXI
          };
        });

        // Compute PXI
        const pxiResult = computePXI(metricSamples);

        const pampCount = pxiResult.metrics.filter(m => m.zScore > 2).length;
        const stressCount = pxiResult.metrics.filter(m => m.zScore < -2).length;
        const totalWeight = pxiResult.metrics.reduce((sum, metric) => sum + Math.max(metric.weight, 0), 0);

        // Insert into database
        const timestamp = new Date(date + 'T12:00:00Z'); // Use noon UTC for historical dates
        await insertHistoricalPXI(
          timestamp,
          pxiResult.pxi,
          pxiResult.zScore,
          pxiResult.regime,
          totalWeight,
          pampCount,
          stressCount,
          {
            thresholds: { stable: 1, caution: 2, stress: 3, crisis: 4 },
            seeded: true,
          }
        );

        processed++;
        if (processed % 10 === 0) {
          logger.info({ processed, total: dates.length }, 'Progress');
        }
      } catch (error) {
        errors++;
        logger.error({ date, error }, 'Failed to process date');
      }
    }

    logger.info({ processed, errors, total: dates.length }, 'Historical PXI computation completed');
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'Historical PXI computation failed',
    );
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  computeHistoricalPXI()
    .then(() => {
      logger.info('Historical PXI computation finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Historical PXI computation failed');
      process.exit(1);
    });
}

export { computeHistoricalPXI };
