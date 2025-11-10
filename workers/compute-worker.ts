#!/usr/bin/env node
/**
 * Enhanced Compute Worker
 *
 * Calculates the PXI composite index using statistical z-scores
 * from 10-year rolling window statistics.
 *
 * Key enhancements:
 * - Statistical z-scores: (value - μ) / σ
 * - Dynamic weighting: α=1.5 for |z|>1.0, β=2.0 for |z|>2.0
 * - Regime classification based on composite thresholds
 * - Alert generation for threshold breaches
 * - Historical data storage for rolling window
 */

import {
  fetchLatestMetricSamples,
  fetchLatestStats,
  insertZScores,
  insertContributions,
  insertCompositePxiRegime,
  insertAlerts,
  insertHistoricalValues,
  insertComposite,
  closePool,
} from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { logger } from '../logger.js';

// Dynamic weight multipliers from spec
const ALPHA = 1.5; // Multiplier when |z| > 1.0
const BETA = 2.0;  // Multiplier when |z| > 2.0

// Alert thresholds
const Z_ALERT_THRESHOLD = 1.5;
const PXI_ALERT_THRESHOLD = 1.0;
const PXI_JUMP_THRESHOLD = 0.5;

// Track previous PXI for jump detection
let previousPxi: number | null = null;

// Track previous raw values for deviation detection (10% rule)
const previousRawValues = new Map<string, number>();

/**
 * Calculate statistical z-score
 */
function calculateStatisticalZScore(
  value: number,
  mean: number,
  stddev: number,
): number {
  if (stddev === 0) {
    logger.warn({ value, mean }, 'Standard deviation is zero, returning 0');
    return 0;
  }
  return (value - mean) / stddev;
}

/**
 * Determine dynamic weight multiplier based on z-score magnitude
 */
function getWeightMultiplier(zScore: number): number {
  const absZ = Math.abs(zScore);
  if (absZ > 2.0) return BETA;
  if (absZ > 1.0) return ALPHA;
  return 1.0;
}

/**
 * Classify regime based on composite PXI value
 */
function classifyRegime(pxiValue: number): string {
  const absValue = Math.abs(pxiValue);
  if (absValue > 2.0) return 'Crisis';
  if (absValue > 1.0) return 'Elevated Stress';
  return 'Normal';
}

/**
 * Main computation logic
 */
async function computePXI(): Promise<void> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const dateOnly = timestamp.split('T')[0]; // YYYY-MM-DD for history_values

  logger.info('Starting enhanced PXI computation cycle');

  try {
    // 1. Fetch latest samples and statistics
    const samples = await fetchLatestMetricSamples();
    const statsMap = await fetchLatestStats();

    if (samples.length === 0) {
      logger.warn('No metric samples found, skipping computation');
      return;
    }

    if (statsMap.size === 0) {
      logger.warn('No historical statistics found. Run backfill worker first.');
      return;
    }

    // 2. Create lookup maps
    const defMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));
    const sampleMap = new Map(samples.map((s) => [s.metricId, s]));

    // 3. Arrays to collect database inserts
    const zScoresToInsert: Array<{
      indicatorId: string;
      timestamp: string;
      rawValue: number;
      meanValue: number;
      stddevValue: number;
      zScore: number;
    }> = [];

    const contributionsToInsert: Array<{
      indicatorId: string;
      timestamp: string;
      rawValue: number;
      zScore: number;
      baseWeight: number;
      actualWeight: number;
      weightMultiplier: number;
      contribution: number;
    }> = [];

    const historyValuesToInsert: Array<{
      indicatorId: string;
      date: string;
      rawValue: number;
      source: string;
    }> = [];

    const alertsToInsert: Array<{
      alertType: string;
      indicatorId: string | null;
      timestamp: string;
      rawValue: number | null;
      zScore: number | null;
      weight: number | null;
      contribution: number | null;
      threshold: number | null;
      message: string;
      severity: 'info' | 'warning' | 'critical';
    }> = [];

    // 4. Calculate z-scores and contributions for each metric
    const metricResults: Array<{
      id: string;
      value: number;
      zScore: number;
      contribution: number;
      weight: number;
      weightMultiplier: number;
    }> = [];

    let pampCount = 0;
    let stressCount = 0;
    let totalWeight = 0;

    for (const def of pxiMetricDefinitions) {
      const sample = sampleMap.get(def.id);
      const stats = statsMap.get(def.id);

      if (!sample) {
        logger.warn({ metricId: def.id }, 'No sample found for metric');
        continue;
      }

      if (!stats) {
        logger.warn({ metricId: def.id }, 'No historical stats found for metric');
        continue;
      }

      // Calculate statistical z-score
      const zScore = calculateStatisticalZScore(
        sample.value,
        stats.mean,
        stats.stddev,
      );

      // Apply dynamic weighting
      const weightMultiplier = getWeightMultiplier(zScore);
      const actualWeight = def.weight * weightMultiplier;

      // Apply directional multiplier based on risk_direction
      // higher_is_more_risk: direction = 1 (positive z-score = more risk)
      // higher_is_less_risk: direction = -1 (positive z-score = less risk, inverted contribution)
      const direction = def.riskDirection === 'higher_is_more_risk' ? 1 : -1;
      const contribution = actualWeight * zScore * direction;

      totalWeight += actualWeight;

      // Track PAMP/Stress counts
      if (zScore > 2) pampCount++;
      if (zScore < -2) stressCount++;

      // Store for later
      metricResults.push({
        id: def.id,
        value: sample.value,
        zScore,
        contribution,
        weight: actualWeight,
        weightMultiplier,
      });

      // Prepare database inserts
      zScoresToInsert.push({
        indicatorId: def.id,
        timestamp,
        rawValue: sample.value,
        meanValue: stats.mean,
        stddevValue: stats.stddev,
        zScore,
      });

      contributionsToInsert.push({
        indicatorId: def.id,
        timestamp,
        rawValue: sample.value,
        zScore,
        baseWeight: def.weight,
        actualWeight,
        weightMultiplier,
        contribution,
      });

      historyValuesToInsert.push({
        indicatorId: def.id,
        date: dateOnly,
        rawValue: sample.value,
        source: 'live_feed',
      });

      // Check for 10% deviation from previous value (bounds review logic)
      const prevValue = previousRawValues.get(def.id);
      if (prevValue !== undefined && prevValue !== 0) {
        const percentChange = Math.abs((sample.value - prevValue) / prevValue);
        if (percentChange > 0.10) {
          alertsToInsert.push({
            alertType: 'deviation_review',
            indicatorId: def.id,
            timestamp,
            rawValue: sample.value,
            zScore,
            weight: null,
            contribution: null,
            threshold: 0.10,
            message: `${def.label}: ${(percentChange * 100).toFixed(1)}% deviation from previous value (${prevValue.toFixed(4)} → ${sample.value.toFixed(4)}). Review recommended.`,
            severity: 'info',
          });
          logger.warn(
            {
              indicator: def.id,
              prevValue,
              currentValue: sample.value,
              percentChange: (percentChange * 100).toFixed(1) + '%',
            },
            'Large deviation detected - flagged for review',
          );
        }
      }
      previousRawValues.set(def.id, sample.value);

      // Generate alerts for high z-scores
      if (Math.abs(zScore) > Z_ALERT_THRESHOLD) {
        const severity = Math.abs(zScore) > 2.5 ? 'critical' : 'warning';
        alertsToInsert.push({
          alertType: 'high_z_score',
          indicatorId: def.id,
          timestamp,
          rawValue: sample.value,
          zScore,
          weight: actualWeight,
          contribution,
          threshold: Z_ALERT_THRESHOLD,
          message: `${def.label}: z-score ${zScore.toFixed(2)} exceeds threshold ${Z_ALERT_THRESHOLD}`,
          severity,
        });
      }
    }

    if (metricResults.length === 0) {
      logger.error('No valid metric results, aborting computation');
      return;
    }

    // 5. Calculate composite PXI (sum of weighted z-scores)
    const compositePxiValue = metricResults.reduce((sum, m) => sum + m.contribution, 0);

    // 6. Classify regime
    const regime = classifyRegime(compositePxiValue);

    // 7. Generate composite-level alerts
    if (Math.abs(compositePxiValue) > PXI_ALERT_THRESHOLD) {
      const severity = Math.abs(compositePxiValue) > 2.0 ? 'critical' : 'warning';
      alertsToInsert.push({
        alertType: 'composite_breach',
        indicatorId: null,
        timestamp,
        rawValue: compositePxiValue,
        zScore: compositePxiValue,
        weight: totalWeight,
        contribution: null,
        threshold: PXI_ALERT_THRESHOLD,
        message: `Composite PXI ${compositePxiValue.toFixed(2)} in ${regime} regime`,
        severity,
      });
    }

    // Check for PXI jump
    if (previousPxi !== null && Math.abs(compositePxiValue - previousPxi) > PXI_JUMP_THRESHOLD) {
      alertsToInsert.push({
        alertType: 'pxi_jump',
        indicatorId: null,
        timestamp,
        rawValue: compositePxiValue,
        zScore: null,
        weight: null,
        contribution: null,
        threshold: PXI_JUMP_THRESHOLD,
        message: `PXI jumped from ${previousPxi.toFixed(2)} to ${compositePxiValue.toFixed(2)} (Δ=${(compositePxiValue - previousPxi).toFixed(2)})`,
        severity: 'warning',
      });
    }

    previousPxi = compositePxiValue;

    // 8. Insert into new enhanced tables
    await insertZScores(zScoresToInsert);
    await insertContributions(contributionsToInsert);
    await insertCompositePxiRegime({
      timestamp,
      pxiValue: compositePxiValue,
      pxiZScore: compositePxiValue, // PXI itself is already a weighted sum of z-scores
      regime,
      totalWeight,
      pampCount,
      stressCount,
    });
    await insertHistoricalValues(historyValuesToInsert);
    await insertAlerts(alertsToInsert);

    // 9. Also insert into legacy composite table for backward compatibility
    // Convert composite PXI to 0-100 scale for display
    const pxiDisplay = Math.max(0, Math.min(100, 50 + compositePxiValue * 12.5));

    await insertComposite({
      calculatedAt: timestamp,
      zScore: compositePxiValue,
      pxi: pxiDisplay,
      metrics: metricResults.map((m) => ({
        id: m.id,
        value: m.value,
        zScore: m.zScore,
        contribution: m.contribution,
      })),
      breaches: {
        pamp: metricResults.filter((m) => m.zScore > 2).map((m) => m.id),
        stress: metricResults.filter((m) => m.zScore < -2).map((m) => m.id),
        systemLevel: regime === 'Normal' ? null : regime,
      },
    });

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        regime,
        compositePxi: compositePxiValue.toFixed(3),
        pxiDisplay: pxiDisplay.toFixed(2),
        pampCount,
        stressCount,
        alertCount: alertsToInsert.length,
        totalWeight: totalWeight.toFixed(2),
      },
      'Enhanced PXI computation completed successfully',
    );
  } catch (error) {
    logger.error({ error }, 'PXI computation failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await computePXI();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in compute worker');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in compute worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in compute worker');
  process.exit(1);
});

// Run the worker
main();
