#!/usr/bin/env node
/**
 * Compute Worker
 *
 * Calculates the PXI composite index from the latest metric samples.
 * Computes z-scores, weighted contributions, and breach states.
 * Runs on a 1-minute cadence via cron or manual execution.
 */

import {
  fetchLatestMetricSamples,
  insertComposite,
  closePool,
} from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { logger } from '../logger.js';
import type { MetricId } from '../shared/types.js';

/**
 * Calculate z-score for a metric value
 *
 * Formula: z = (value - midpoint) / range * polarity
 * Where:
 * - midpoint = (lower + upper) / 2
 * - range = (upper - lower) / 2
 * - polarity = 1 for positive, -1 for negative
 */
function calculateZScore(
  value: number,
  lower: number,
  upper: number,
  polarity: 'positive' | 'negative',
): number {
  const midpoint = (lower + upper) / 2;
  const range = (upper - lower) / 2;
  const polarityMultiplier = polarity === 'positive' ? 1 : -1;
  const rawZScore = ((value - midpoint) / range) * polarityMultiplier;
  return rawZScore;
}

/**
 * Classify z-score into breach state
 */
function classifyZScore(zScore: number): 'PAMP' | 'Stress' | null {
  if (zScore > 2) return 'PAMP';
  if (zScore < -2) return 'Stress';
  return null;
}

/**
 * Main computation logic
 */
async function computePXI(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting PXI computation cycle');

  try {
    // Fetch latest samples from database
    const samples = await fetchLatestMetricSamples();

    if (samples.length === 0) {
      logger.warn('No metric samples found, skipping computation');
      return;
    }

    // Check if we have all required metrics
    const expectedMetrics = pxiMetricDefinitions.map((def) => def.id);
    const receivedMetrics = samples.map((s) => s.metricId);
    const missingMetrics = expectedMetrics.filter(
      (id) => !receivedMetrics.includes(id),
    );

    if (missingMetrics.length > 0) {
      logger.warn(
        { missing: missingMetrics },
        'Missing some metrics, computation may be incomplete',
      );
    }

    // Create a map of metric definitions for quick lookup
    const defMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));

    // Create a map of sample values
    const sampleMap = new Map(samples.map((s) => [s.metricId, s]));

    // Calculate z-scores and contributions for each metric
    const metricResults = pxiMetricDefinitions
      .map((def) => {
        const sample = sampleMap.get(def.id);
        if (!sample) {
          logger.warn({ metricId: def.id }, 'No sample found for metric');
          return null;
        }

        const zScore = calculateZScore(
          sample.value,
          def.lowerBound,
          def.upperBound,
          def.polarity,
        );

        // Contribution is z-score * weight
        const contribution = zScore * def.weight;

        return {
          id: def.id,
          value: sample.value,
          zScore,
          contribution,
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null);

    if (metricResults.length === 0) {
      logger.error('No valid metric results, aborting computation');
      return;
    }

    // Calculate weighted z-score sum and total weight
    const totalContribution = metricResults.reduce(
      (sum, m) => sum + m.contribution,
      0,
    );
    const totalWeight = metricResults.reduce((sum, m) => {
      const def = defMap.get(m.id as MetricId);
      return sum + (def?.weight ?? 0);
    }, 0);

    // Composite z-score is the weighted average
    const compositeZScore = totalContribution / totalWeight;

    // Convert z-score to PXI scale (0-100)
    // PXI = 50 + (z-score * 12.5)
    // This maps:
    //   z = -4 => PXI = 0
    //   z = -2 => PXI = 25
    //   z = 0  => PXI = 50
    //   z = +2 => PXI = 75
    //   z = +4 => PXI = 100
    const pxi = Math.max(0, Math.min(100, 50 + compositeZScore * 12.5));

    // Detect breaches
    const pampBreaches: string[] = [];
    const stressBreaches: string[] = [];

    metricResults.forEach((metric) => {
      const state = classifyZScore(metric.zScore);
      if (state === 'PAMP') {
        pampBreaches.push(metric.id);
      } else if (state === 'Stress') {
        stressBreaches.push(metric.id);
      }
    });

    // System-level breach (composite PXI)
    let systemLevel: string | null = null;
    if (pxi >= 75) {
      systemLevel = 'PAMP';
    } else if (pxi <= 30) {
      systemLevel = 'Stress';
    }

    // Build composite record
    const composite = {
      calculatedAt: new Date().toISOString(),
      zScore: compositeZScore,
      pxi,
      metrics: metricResults,
      breaches: {
        pamp: pampBreaches,
        stress: stressBreaches,
        systemLevel,
      },
    };

    // Insert into database
    await insertComposite(composite);

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        pxi: pxi.toFixed(2),
        zScore: compositeZScore.toFixed(3),
        systemLevel,
        pampCount: pampBreaches.length,
        stressCount: stressBreaches.length,
      },
      'PXI computation completed successfully',
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
