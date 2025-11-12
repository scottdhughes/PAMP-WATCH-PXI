#!/usr/bin/env tsx
/**
 * Recalculate Historical PXI (30 Days)
 *
 * Recalculates PXI values for the past 30 days using only metrics
 * with sufficient 90-day rolling window data. This ensures consistent
 * methodology across the historical chart.
 *
 * Usage:
 *   npx tsx scripts/recalculate-historical-pxi.ts
 */

import { pool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { logger } from '../logger.js';
import { mean, std } from 'mathjs';

const DAYS_TO_RECALCULATE = 30;
const ROLLING_WINDOW_DAYS = 90;
const MIN_SAMPLES_FOR_Z_SCORE = 5;
const ALPHA = 1.5; // Multiplier when |z| > 1.0
const BETA = 2.0;  // Multiplier when |z| > 2.0

interface DailyMetricData {
  metricId: string;
  value: number;
  timestamp: Date;
}

/**
 * Resample to daily frequency (last value per day)
 */
function resampleToDaily(data: Array<{ value: number; timestamp: Date }>): number[] {
  const dailyMap = new Map<string, { value: number; timestamp: Date }>();

  for (const point of data) {
    const dateKey = point.timestamp.toISOString().split('T')[0];
    const existing = dailyMap.get(dateKey);

    if (!existing || point.timestamp > existing.timestamp) {
      dailyMap.set(dateKey, point);
    }
  }

  const sortedDates = Array.from(dailyMap.keys()).sort();
  return sortedDates.map(date => dailyMap.get(date)!.value);
}

/**
 * Calculate z-score with daily resampling
 */
function calculateZScore(
  currentValue: number,
  historicalData: Array<{ value: number; timestamp: Date }>
): number | null {
  const dailyValues = resampleToDaily(historicalData);

  if (dailyValues.length < MIN_SAMPLES_FOR_Z_SCORE) {
    return null;
  }

  const μ = mean(dailyValues) as number;
  const σ = std(dailyValues, 'unbiased') as number;

  if (σ < 1e-9) {
    return 0; // Flatline data
  }

  return (currentValue - μ) / σ;
}

/**
 * Get weight multiplier based on z-score
 */
function getWeightMultiplier(zScore: number): number {
  const absZ = Math.abs(zScore);
  if (absZ > 2.0) return BETA;
  if (absZ > 1.0) return ALPHA;
  return 1.0;
}

/**
 * Classify regime based on PXI value
 */
function classifyRegime(pxiValue: number): string {
  if (pxiValue > 2.0) return 'Strong PAMP';
  if (pxiValue > 1.0) return 'Moderate PAMP';
  if (pxiValue >= -1.0) return 'Normal';
  if (pxiValue >= -2.0) return 'Elevated Stress';
  return 'Crisis';
}

/**
 * Get all dates in the past N days
 */
async function getDatesToRecalculate(days: number): Promise<Date[]> {
  const result = await pool.query<{ date: Date }>(
    `SELECT DISTINCT DATE(source_timestamp) as date
     FROM pxi_metric_samples
     WHERE source_timestamp >= NOW() - INTERVAL '${days} days'
     ORDER BY date DESC`
  );

  return result.rows.map(r => new Date(r.date));
}

/**
 * Get latest metric value for a specific date
 */
async function getMetricValueForDate(metricId: string, targetDate: Date): Promise<number | null> {
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const result = await pool.query<{ value: number }>(
    `SELECT value
     FROM pxi_metric_samples
     WHERE metric_id = $1
       AND source_timestamp >= $2
       AND source_timestamp < $3
     ORDER BY source_timestamp DESC
     LIMIT 1`,
    [metricId, targetDate, nextDay]
  );

  return result.rows.length > 0 ? result.rows[0].value : null;
}

/**
 * Get historical data for z-score calculation
 */
async function getHistoricalData(
  metricId: string,
  targetDate: Date
): Promise<Array<{ value: number; timestamp: Date }>> {
  const windowStart = new Date(targetDate);
  windowStart.setDate(windowStart.getDate() - ROLLING_WINDOW_DAYS);

  const result = await pool.query<{ value: number; source_timestamp: Date }>(
    `SELECT value, source_timestamp
     FROM pxi_metric_samples
     WHERE metric_id = $1
       AND source_timestamp >= $2
       AND source_timestamp < $3
     ORDER BY source_timestamp ASC`,
    [metricId, windowStart, targetDate]
  );

  return result.rows.map(r => ({
    value: r.value,
    timestamp: new Date(r.source_timestamp)
  }));
}

/**
 * Recalculate PXI for a specific date
 */
async function recalculatePXIForDate(targetDate: Date): Promise<void> {
  logger.info({ date: targetDate.toISOString().split('T')[0] }, 'Recalculating PXI for date');

  const metricResults: Array<{
    id: string;
    value: number;
    zScore: number;
    weight: number;
    contribution: number;
  }> = [];

  let pampCount = 0;
  let stressCount = 0;
  let totalWeight = 0;

  // Process each metric
  for (const def of pxiMetricDefinitions) {
    // Get metric value for this date
    const value = await getMetricValueForDate(def.id, targetDate);

    if (value === null) {
      logger.debug({ metricId: def.id }, 'No value found for date');
      continue;
    }

    // Get historical data for z-score calculation
    const historicalData = await getHistoricalData(def.id, targetDate);

    // Calculate z-score
    const zScore = calculateZScore(value, historicalData);

    if (zScore === null) {
      logger.debug({ metricId: def.id, samples: historicalData.length }, 'Insufficient data for z-score');
      continue;
    }

    // Apply dynamic weighting
    const weightMultiplier = getWeightMultiplier(zScore);
    const actualWeight = def.weight * weightMultiplier;

    // Apply directional multiplier
    const direction = def.riskDirection === 'higher_is_more_risk' ? -1 : 1;
    const contribution = actualWeight * zScore * direction;

    totalWeight += actualWeight;

    if (zScore > 2) pampCount++;
    if (zScore < -2) stressCount++;

    metricResults.push({
      id: def.id,
      value,
      zScore,
      weight: actualWeight,
      contribution
    });
  }

  if (metricResults.length === 0) {
    logger.warn({ date: targetDate.toISOString().split('T')[0] }, 'No valid metrics for date, skipping');
    return;
  }

  // Calculate composite PXI with normalized weights
  let compositePxiValue = 0;

  for (const metric of metricResults) {
    const normalizedWeight = totalWeight > 0 ? metric.weight / totalWeight : 0;
    const def = pxiMetricDefinitions.find(d => d.id === metric.id)!;
    const direction = def.riskDirection === 'higher_is_more_risk' ? -1 : 1;
    const normalizedContribution = normalizedWeight * metric.zScore * direction;

    metric.contribution = normalizedContribution;
    compositePxiValue += normalizedContribution;
  }

  // Round and clamp
  compositePxiValue = parseFloat(compositePxiValue.toFixed(3));
  if (compositePxiValue > 3) compositePxiValue = 3;
  if (compositePxiValue < -3) compositePxiValue = -3;

  const regime = classifyRegime(compositePxiValue);

  // Insert into composite_pxi_regime
  const timestamp = new Date(targetDate);
  timestamp.setHours(12, 0, 0, 0); // Use noon for consistent daily timestamp

  await pool.query(
    `INSERT INTO composite_pxi_regime (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (timestamp) DO UPDATE
     SET pxi_value = EXCLUDED.pxi_value,
         pxi_z_score = EXCLUDED.pxi_z_score,
         regime = EXCLUDED.regime,
         total_weight = EXCLUDED.total_weight,
         pamp_count = EXCLUDED.pamp_count,
         stress_count = EXCLUDED.stress_count`,
    [timestamp, compositePxiValue, compositePxiValue, regime, totalWeight, pampCount, stressCount]
  );

  logger.info({
    date: targetDate.toISOString().split('T')[0],
    pxi: compositePxiValue.toFixed(3),
    regime,
    metricsUsed: metricResults.length,
    totalWeight: totalWeight.toFixed(2)
  }, 'PXI recalculated for date');
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  logger.info({ days: DAYS_TO_RECALCULATE }, 'Starting historical PXI recalculation');

  try {
    // Get all dates to recalculate
    const dates = await getDatesToRecalculate(DAYS_TO_RECALCULATE);
    logger.info({ dateCount: dates.length }, 'Found dates to recalculate');

    // Process each date
    for (const date of dates) {
      await recalculatePXIForDate(date);
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, datesProcessed: dates.length }, 'Historical PXI recalculation completed');

    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Historical PXI recalculation failed');
    await pool.end();
    process.exit(1);
  }
}

main();
