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
  return result.rows.map(r => r.date);
}

/**
 * Get metrics for a specific date
 */
async function getMetricsForDate(date: string): Promise<Record<string, HistoricalMetric>> {
  const result = await pool.query<HistoricalMetric>(
    `SELECT indicator_id as "indicatorId", date, value, mean, stddev
     FROM history_values
     WHERE date = $1`,
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
  regime: string,
  thresholds: any
): Promise<void> {
  await pool.query(
    `INSERT INTO composite_pxi_regime (timestamp, pxi_value, regime, weight_sum, thresholds)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (timestamp) DO UPDATE
     SET pxi_value = EXCLUDED.pxi_value,
         regime = EXCLUDED.regime,
         weight_sum = EXCLUDED.weight_sum,
         thresholds = EXCLUDED.thresholds`,
    [timestamp, pxiValue, regime, 7.0, JSON.stringify(thresholds)]
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
        const requiredMetrics = ['hyOas', 'igOas', 'vix', 'u3', 'usd', 'nfci', 'btcReturn'];
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

        // Insert into database
        const timestamp = new Date(date + 'T12:00:00Z'); // Use noon UTC for historical dates
        await insertHistoricalPXI(
          timestamp,
          pxiResult.pxi,
          pxiResult.regime,
          { stable: 1, caution: 2, stress: 3, crisis: 4 }
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
    logger.error({ error }, 'Historical PXI computation failed');
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
