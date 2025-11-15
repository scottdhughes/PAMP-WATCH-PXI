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
import {
  REQUIRED_METRIC_IDS,
  fetchAvailableHistoryDates,
  fetchHistoricalMetricsForDate,
  hasAllRequiredMetrics,
} from '../lib/history.js';

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
    const dates = await fetchAvailableHistoryDates(30);
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
        const metrics = await fetchHistoricalMetricsForDate(date);
        const { ok, missing } = hasAllRequiredMetrics(metrics, REQUIRED_METRIC_IDS);
        if (!ok) {
          logger.debug({ date, missingMetrics: missing }, 'Skipping date with missing metrics');
          continue;
        }

        // Prepare metrics in the format expected by computePXI
        const metricSamples = REQUIRED_METRIC_IDS.map(id => {
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
