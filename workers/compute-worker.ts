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
  getRecentAlerts,
  closePool,
} from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

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
 * Positive PXI = PAMP (low stress)
 * Negative PXI = Stress/Crisis
 *
 * Thresholds (non-overlapping):
 * - Strong PAMP: PXI > 2.0
 * - Moderate PAMP: 1.0 < PXI <= 2.0
 * - Normal: -1.0 <= PXI <= 1.0
 * - Elevated Stress: -2.0 <= PXI < -1.0
 * - Crisis: PXI < -2.0
 */
function classifyRegime(pxiValue: number): string {
  if (pxiValue > 2.0) {
    return 'Strong PAMP';
  } else if (pxiValue > 1.0) {
    return 'Moderate PAMP';
  } else if (pxiValue >= -1.0) {
    return 'Normal';
  } else if (pxiValue >= -2.0) {
    return 'Elevated Stress';
  } else {
    return 'Crisis';
  }
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
      normalizedWeight: number;
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

      if (!sample) {
        logger.warn({ metricId: def.id }, 'No sample found for metric');
        continue;
      }

      // Fetch stats for this metric (needed for database inserts)
      const stats = statsMap.get(def.id);
      if (!stats) {
        logger.warn({ metricId: def.id }, 'No historical stats found for metric');
        continue;
      }

      // Use pre-calculated z-score from database if available
      // Fall back to calculating from 90-day stats for metrics with sparse data
      let zScore: number;

      if (sample.zScore !== undefined && sample.zScore !== null && isFinite(sample.zScore)) {
        // Use stored z-score (calculated during ingestion with rolling 90-day window)
        zScore = sample.zScore;
        logger.debug({ metricId: def.id, zScore: zScore.toFixed(3) }, 'Using stored 90-day z-score');
      } else {
        // Fall back to calculating from 90-day stats (latest_stats table)
        // Skip if insufficient data (null stddev or < 5 samples)
        if (!stats.stddev || stats.sampleCount < 5) {
          logger.warn(
            { metricId: def.id, sampleCount: stats.sampleCount },
            'Skipping metric - insufficient 90-day data for z-score calculation'
          );
          continue;
        }

        zScore = calculateStatisticalZScore(
          sample.value,
          stats.mean,
          stats.stddev,
        );
        logger.debug({ metricId: def.id, zScore: zScore.toFixed(3) }, 'Calculated z-score from 90-day stats');
      }

      // Apply dynamic weighting
      const weightMultiplier = getWeightMultiplier(zScore);

      // Apply technical indicator signal multiplier (for BTC)
      // Check if this metric has a signal multiplier in its metadata
      const signalMultiplier = (sample.metadata && typeof sample.metadata.signalMultiplier === 'number')
        ? sample.metadata.signalMultiplier
        : 1.0;

      const actualWeight = def.weight * weightMultiplier * signalMultiplier;

      // Apply directional multiplier based on risk_direction
      // higher_is_more_risk: direction = -1 (negative z-score [below normal] = positive contribution [less stress])
      // higher_is_less_risk: direction = 1 (positive z-score [strong] = positive contribution [less stress])
      const direction = def.riskDirection === 'higher_is_more_risk' ? -1 : 1;
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
        normalizedWeight: 0, // Will be calculated after totalWeight is known
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

          // Check for frequent deviations and suggest bound adjustments
          try {
            const recentAlerts = await getRecentAlerts('deviation_review', def.id, 30);

            // If we exceed the threshold (default 5 alerts in 30 days), suggest wider bounds
            if (recentAlerts.length >= config.boundSuggestThreshold) {
              const currentBounds = def.bounds;
              if (currentBounds) {
                // Suggest widening bounds by 20%
                const suggestedMin = currentBounds.min * 0.8;
                const suggestedMax = currentBounds.max * 1.2;

                alertsToInsert.push({
                  alertType: 'bound_suggestion',
                  indicatorId: def.id,
                  timestamp,
                  rawValue: sample.value,
                  zScore,
                  weight: null,
                  contribution: null,
                  threshold: config.boundSuggestThreshold,
                  message: `Frequent deviations for ${def.label} (${recentAlerts.length} alerts in 30 days, threshold: ${config.boundSuggestThreshold}). Consider updating bounds from [${currentBounds.min.toFixed(4)}, ${currentBounds.max.toFixed(4)}] to [${suggestedMin.toFixed(4)}, ${suggestedMax.toFixed(4)}]`,
                  severity: 'info',
                });

                logger.info(
                  {
                    metric: def.id,
                    alertCount: recentAlerts.length,
                    currentBounds: [currentBounds.min, currentBounds.max],
                    suggestedBounds: [suggestedMin, suggestedMax],
                  },
                  'Bound adjustment suggested due to frequent deviations'
                );
              }
            }
          } catch (error) {
            // Log error but don't fail the compute cycle
            logger.error({ error, metric: def.id }, 'Failed to check for bound suggestions');
          }
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

    // 5. Normalize weights (Step 3: Weight normalization after feed loss)
    // Ensure total_weight = sum(weights.values())
    // For each weight: normalized_weight = weight / total_weight
    logger.info({ totalWeight: totalWeight.toFixed(4) }, 'Normalizing weights');

    // Initial normalization
    const initialNormalizedWeights = new Map<string, number>();
    for (const metric of metricResults) {
      const normalizedWeight = totalWeight > 0 ? metric.weight / totalWeight : 0;
      initialNormalizedWeights.set(metric.id, normalizedWeight);
    }

    // Apply contribution cap (prevents any single metric from dominating)
    const MAX_CONTRIB = config.maxMetricContribution; // Default 25%
    const cappedWeights = new Map<string, number>();
    let totalExcess = 0;

    for (const [metricId, weight] of initialNormalizedWeights) {
      if (weight > MAX_CONTRIB) {
        totalExcess += weight - MAX_CONTRIB;
        cappedWeights.set(metricId, MAX_CONTRIB);
        logger.info({
          metric: metricId,
          originalWeight: (weight * 100).toFixed(1) + '%',
          cappedAt: (MAX_CONTRIB * 100).toFixed(1) + '%',
        }, 'Metric contribution capped');
      } else {
        cappedWeights.set(metricId, weight);
      }
    }

    // Redistribute excess proportionally to non-capped metrics
    if (totalExcess > 0) {
      const nonCappedSum = Array.from(cappedWeights.values())
        .filter(w => w < MAX_CONTRIB)
        .reduce((sum, w) => sum + w, 0);

      if (nonCappedSum > 0) {
        for (const [metricId, weight] of cappedWeights) {
          if (weight < MAX_CONTRIB) {
            const redistributed = weight + (weight / nonCappedSum) * totalExcess;
            cappedWeights.set(metricId, redistributed);
          }
        }
        logger.info({
          excess: (totalExcess * 100).toFixed(1) + '%',
          redistributedTo: Array.from(cappedWeights.entries())
            .filter(([_, w]) => w < MAX_CONTRIB)
            .length,
        }, 'Excess weight redistributed');
      }
    }

    // Calculate contributions with capped weights
    let compositePxiValue = 0;
    for (const metric of metricResults) {
      const normalizedWeight = cappedWeights.get(metric.id) ?? 0;

      // Recalculate contribution with normalized weight
      // Apply direction multiplier based on risk_direction
      const def = defMap.get(metric.id)!;
      const direction = def.riskDirection === 'higher_is_more_risk' ? -1 : 1;
      const normalizedContribution = normalizedWeight * metric.zScore * direction;

      // Update metric result with normalized contribution
      metric.contribution = normalizedContribution;
      compositePxiValue += normalizedContribution;

      // Find the corresponding contribution entry and update it
      const contributionEntry = contributionsToInsert.find(
        (c) => c.indicatorId === metric.id && c.timestamp === timestamp
      );
      if (contributionEntry) {
        contributionEntry.normalizedWeight = normalizedWeight;
        contributionEntry.contribution = normalizedContribution;
      }

      logger.debug({
        indicator: metric.id,
        zScore: metric.zScore.toFixed(3),
        actualWeight: metric.weight.toFixed(4),
        normalizedWeight: normalizedWeight.toFixed(4),
        contribution: normalizedContribution.toFixed(4),
      }, 'Weight normalized and contribution recalculated');
    }

    // 6. Store raw PXI with full precision (before clamping/rounding)
    const rawPxiValue = compositePxiValue;

    // 7. Clamp to realistic range (-3σ to +3σ max)
    // Rationale: Assumes approximate normality for interpretability
    // Raw value preserved for future analysis and backtesting
    let clampedPxiValue = compositePxiValue;
    if (clampedPxiValue > 3) clampedPxiValue = 3;
    if (clampedPxiValue < -3) clampedPxiValue = -3;

    // 8. Round for display/UI (but keep clamped value in calculations)
    const displayPxiValue = parseFloat(clampedPxiValue.toFixed(3));

    // Use clamped value for regime classification and alerts
    compositePxiValue = clampedPxiValue;

    // Debug: Log detailed contribution breakdown
    logger.info('=== PXI Contribution Breakdown ===');
    console.table(metricResults.map(m => ({
      metric: m.id,
      z: m.zScore.toFixed(3),
      weight: (m.weight / totalWeight).toFixed(4),
      contribution: m.contribution.toFixed(4),
    })));
    logger.info({
      compositePxi: compositePxiValue.toFixed(3),
      weightSum: metricResults.reduce((sum, m) => sum + (m.weight / totalWeight), 0).toFixed(4),
    }, 'Composite PXI calculation summary');

    // 8. Classify regime
    const regime = classifyRegime(compositePxiValue);

    // 9. Generate composite-level alerts
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

    // Check for PXI change (first derivative: |current - previous| > threshold)
    // Note: This tracks simple change, not acceleration (second derivative)
    if (previousPxi !== null && Math.abs(compositePxiValue - previousPxi) > PXI_JUMP_THRESHOLD) {
      const deltaPxi = compositePxiValue - previousPxi;
      alertsToInsert.push({
        alertType: 'pxi_change',
        indicatorId: null,
        timestamp,
        rawValue: compositePxiValue,
        zScore: null,
        weight: null,
        contribution: null,
        threshold: PXI_JUMP_THRESHOLD,
        message: `Sudden PXI change: ${Math.abs(deltaPxi).toFixed(3)} (from ${previousPxi.toFixed(3)} to ${compositePxiValue.toFixed(3)})`,
        severity: 'warning',
      });
    }

    previousPxi = compositePxiValue;

    // 10. Insert into new enhanced tables
    await insertZScores(zScoresToInsert);
    await insertContributions(contributionsToInsert);
    await insertCompositePxiRegime({
      timestamp,
      pxiValue: compositePxiValue, // Clamped value
      pxiZScore: compositePxiValue, // PXI itself is already a weighted sum of z-scores
      regime,
      totalWeight,
      pampCount,
      stressCount,
      rawPxiValue: rawPxiValue, // Full precision before clamping
    });
    await insertHistoricalValues(historyValuesToInsert);
    await insertAlerts(alertsToInsert);

    // 11. Also insert into legacy composite table for backward compatibility
    // Store the actual PXI value (not converted to 0-100 scale)
    // The frontend will display the raw PXI value along with the regime
    const pxiDisplay = compositePxiValue;

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
