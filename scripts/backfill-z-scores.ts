#!/usr/bin/env tsx
/**
 * Z-Score Backfill Script
 *
 * Calculates and populates z-scores for all historical metric data
 * using a rolling 90-day window as specified in PXI methodology.
 *
 * Usage:
 *   npx tsx scripts/backfill-z-scores.ts
 */

import { pool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { mean, std } from 'mathjs';
import { logger } from '../logger.js';

// Configuration
const ROLLING_WINDOW_DAYS = 90;
const MIN_SAMPLES_FOR_Z_SCORE = 5; // Minimum data points needed for meaningful statistics
const BATCH_SIZE = 1000; // Update records in batches

interface MetricDataPoint {
  metricId: string;
  value: number;
  sourceTimestamp: Date;
}

/**
 * Calculate z-score for a value given historical series
 */
function calculateZScore(
  currentValue: number,
  historicalValues: number[]
): number | null {
  if (historicalValues.length < MIN_SAMPLES_FOR_Z_SCORE) {
    return null; // Not enough data for meaningful statistics
  }

  const μ = mean(historicalValues) as number;
  const σ = std(historicalValues, 'unbiased') as number;

  // Handle flatline data (zero standard deviation)
  if (σ < 1e-9) {
    return 0;
  }

  return (currentValue - μ) / σ;
}

/**
 * Fetch all metric data for a specific metric
 */
async function fetchMetricData(metricId: string): Promise<MetricDataPoint[]> {
  const result = await pool.query(
    `
    SELECT
      metric_id as "metricId",
      value,
      source_timestamp as "sourceTimestamp"
    FROM pxi_metric_samples
    WHERE metric_id = $1
    ORDER BY source_timestamp ASC
  `,
    [metricId]
  );

  return result.rows;
}

/**
 * Update z-scores for a batch of records
 */
async function updateZScoreBatch(
  updates: Array<{ metricId: string; timestamp: Date; zScore: number }>
): Promise<void> {
  if (updates.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Use a temporary table for efficient batch updates
    await client.query(`
      CREATE TEMP TABLE temp_z_scores (
        metric_id TEXT,
        source_timestamp TIMESTAMPTZ,
        z_score DOUBLE PRECISION
      ) ON COMMIT DROP
    `);

    // Insert updates into temp table
    const values = updates
      .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`)
      .join(', ');

    const params = updates.flatMap((u) => [
      u.metricId,
      u.timestamp,
      u.zScore,
    ]);

    await client.query(
      `INSERT INTO temp_z_scores (metric_id, source_timestamp, z_score) VALUES ${values}`,
      params
    );

    // Perform batch update
    await client.query(`
      UPDATE pxi_metric_samples AS pms
      SET z_score = tzs.z_score
      FROM temp_z_scores AS tzs
      WHERE pms.metric_id = tzs.metric_id
        AND pms.source_timestamp = tzs.source_timestamp
    `);

    await client.query('COMMIT');

    logger.info(
      { count: updates.length },
      'Z-score batch update completed'
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Process a single metric: calculate z-scores for all data points
 */
async function processMetric(metricId: string, label: string): Promise<void> {
  logger.info({ metricId, label }, 'Processing metric');

  // Fetch all data for this metric
  const dataPoints = await fetchMetricData(metricId);

  if (dataPoints.length === 0) {
    logger.warn({ metricId }, 'No data found for metric');
    return;
  }

  logger.info(
    { metricId, dataPoints: dataPoints.length },
    'Fetched metric data'
  );

  // Calculate z-scores using rolling window
  const updates: Array<{
    metricId: string;
    timestamp: Date;
    zScore: number;
  }> = [];

  for (let i = 0; i < dataPoints.length; i++) {
    const currentPoint = dataPoints[i];
    const currentTimestamp = new Date(currentPoint.sourceTimestamp);

    // Define rolling window: 90 days before current point
    const windowStart = new Date(currentTimestamp);
    windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);

    // Collect all values within the rolling window (excluding current point)
    const windowValues: number[] = [];
    for (let j = 0; j < i; j++) {
      const pointTimestamp = new Date(dataPoints[j].sourceTimestamp);
      if (pointTimestamp >= windowStart && pointTimestamp < currentTimestamp) {
        windowValues.push(dataPoints[j].value);
      }
    }

    // Calculate z-score
    const zScore = calculateZScore(currentPoint.value, windowValues);

    if (zScore !== null) {
      updates.push({
        metricId: currentPoint.metricId,
        timestamp: currentPoint.sourceTimestamp,
        zScore,
      });
    }

    // Batch update when we reach batch size
    if (updates.length >= BATCH_SIZE) {
      await updateZScoreBatch(updates);
      updates.length = 0; // Clear array
    }
  }

  // Update remaining records
  if (updates.length > 0) {
    await updateZScoreBatch(updates);
  }

  logger.info(
    { metricId, totalUpdates: dataPoints.length },
    'Metric processing complete'
  );
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  logger.info('Starting z-score backfill process');

  try {
    // Get list of metrics to process
    const metricsToProcess = pxiMetricDefinitions.map((def) => ({
      id: def.id,
      label: def.label,
    }));

    logger.info(
      { metricCount: metricsToProcess.length },
      'Metrics to process'
    );

    // Process each metric sequentially
    for (const metric of metricsToProcess) {
      await processMetric(metric.id, metric.label);
    }

    // Final statistics
    const statsResult = await pool.query(`
      SELECT
        metric_id,
        COUNT(*) as total,
        COUNT(z_score) as with_z_score,
        COUNT(*) - COUNT(z_score) as without_z_score
      FROM pxi_metric_samples
      GROUP BY metric_id
      ORDER BY metric_id
    `);

    logger.info({ stats: statsResult.rows }, 'Z-score backfill statistics');

    const duration = Date.now() - startTime;
    logger.info({ duration }, 'Z-score backfill completed successfully');

    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Z-score backfill failed');
    await pool.end();
    process.exit(1);
  }
}

main();
