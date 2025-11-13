#!/usr/bin/env node
/**
 * Weight Optimization Script (Phase 4: Quant Optimization)
 *
 * Analyzes historical metric data to suggest optimal PXI weights based on:
 * 1. Correlation with PXI movements (regime predictions)
 * 2. Predictive power for regime transitions
 * 3. Stability and consistency over time
 *
 * Outputs recommendations to JSON for manual review before applying.
 *
 * Usage:
 *   npx tsx scripts/optimize-weights.ts [--days=365] [--target=pxi|regime]
 */

import { fetchHistoricalMetricData, fetchHistoricalPxiRegimes, closePool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { pearsonCorrelation, mean, standardDeviation } from '../utils/statistics.js';
import { logger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

interface OptimizationResult {
  timestamp: string;
  daysAnalyzed: number;
  targetMetric: 'pxi' | 'regime';
  currentWeights: Record<string, number>;
  suggestedWeights: Record<string, number>;
  correlations: Record<string, number>;
  improvements: Record<string, { current: number; suggested: number; change: string }>;
  summary: {
    totalCurrentWeight: number;
    totalSuggestedWeight: number;
    avgCorrelation: number;
    topPerformers: string[];
    bottomPerformers: string[];
  };
}

/**
 * Align time series data by date
 * Returns array of values for dates that exist in both series
 */
function alignTimeSeries(
  series1: Array<{ date: string; value: number }>,
  series2: Array<{ date: string; value: number }>
): { values1: number[]; values2: number[] } {
  const map1 = new Map(series1.map((d) => [d.date, d.value]));
  const map2 = new Map(series2.map((d) => [d.date, d.value]));

  const commonDates = Array.from(map1.keys()).filter((date) => map2.has(date)).sort();

  return {
    values1: commonDates.map((date) => map1.get(date)!),
    values2: commonDates.map((date) => map2.get(date)!),
  };
}

/**
 * Convert regime names to numeric values for correlation
 */
function regimeToNumeric(regime: string): number {
  const regimeMap: Record<string, number> = {
    Crisis: -2,
    'Elevated Stress': -1,
    Normal: 0,
    'Moderate PAMP': 1,
    'Strong PAMP': 2,
  };
  return regimeMap[regime] ?? 0;
}

/**
 * Calculate weight suggestions based on correlations
 */
function calculateSuggestedWeights(
  correlations: Record<string, number>,
  currentWeights: Record<string, number>
): Record<string, number> {
  // Normalize correlations to positive range [0, 1]
  // Higher absolute correlation = higher suggested weight
  const absCorrelations: Record<string, number> = {};
  for (const metricId in correlations) {
    absCorrelations[metricId] = Math.abs(correlations[metricId]);
  }

  // Calculate total correlation strength
  const totalCorr = Object.values(absCorrelations).reduce((sum, val) => sum + val, 0);

  // Calculate total current weight
  const totalCurrentWeight = Object.values(currentWeights).reduce((sum, val) => sum + val, 0);

  // Suggest weights proportional to correlation strength
  const suggestedWeights: Record<string, number> = {};

  for (const metricId in correlations) {
    if (totalCorr === 0) {
      // No correlation data - keep current weight
      suggestedWeights[metricId] = currentWeights[metricId];
    } else {
      // Weight proportional to correlation strength
      const rawSuggested = (absCorrelations[metricId] / totalCorr) * totalCurrentWeight;

      // Apply bounds: min 0.5, max 2.5 (from pxiMetrics definitions)
      const bounded = Math.max(0.5, Math.min(2.5, rawSuggested));

      suggestedWeights[metricId] = bounded;
    }
  }

  // Normalize to match total current weight
  const totalSuggested = Object.values(suggestedWeights).reduce((sum, val) => sum + val, 0);
  const scaleFactor = totalCurrentWeight / totalSuggested;

  for (const metricId in suggestedWeights) {
    suggestedWeights[metricId] *= scaleFactor;
  }

  return suggestedWeights;
}

/**
 * Main optimization function
 */
async function optimizeWeights(
  days: number = 365,
  targetMetric: 'pxi' | 'regime' = 'pxi'
): Promise<void> {
  const startTime = Date.now();
  logger.info({ days, targetMetric }, 'Starting weight optimization');

  try {
    // 1. Fetch historical data
    logger.info('Fetching historical metric data...');
    const metricData = await fetchHistoricalMetricData(days);

    logger.info('Fetching historical PXI/regime data...');
    const pxiData = await fetchHistoricalPxiRegimes(days);

    if (pxiData.length === 0) {
      throw new Error('No historical PXI data found. Run backfill first.');
    }

    // 2. Prepare target variable
    const targetSeries: Array<{ date: string; value: number }> =
      targetMetric === 'pxi'
        ? pxiData.map((d) => ({ date: d.date, value: d.pxiValue }))
        : pxiData.map((d) => ({ date: d.date, value: regimeToNumeric(d.regime) }));

    logger.info({ targetPoints: targetSeries.length }, `Target metric: ${targetMetric}`);

    // 3. Calculate correlations for each metric
    const correlations: Record<string, number> = {};
    const currentWeights: Record<string, number> = {};

    for (const def of pxiMetricDefinitions) {
      const metricId = def.id;
      currentWeights[metricId] = def.weight;

      const metricSeries = metricData.get(metricId);
      if (!metricSeries || metricSeries.length === 0) {
        logger.warn({ metricId }, 'No historical data found for metric');
        correlations[metricId] = 0;
        continue;
      }

      // Align time series
      const { values1, values2 } = alignTimeSeries(metricSeries, targetSeries);

      if (values1.length < 30) {
        logger.warn({ metricId, points: values1.length }, 'Insufficient aligned data points');
        correlations[metricId] = 0;
        continue;
      }

      // Calculate Pearson correlation
      const corr = pearsonCorrelation(values1, values2);
      correlations[metricId] = isNaN(corr) ? 0 : corr;

      logger.info(
        {
          metricId,
          correlation: corr.toFixed(4),
          alignedPoints: values1.length,
          currentWeight: def.weight,
        },
        'Metric correlation computed'
      );
    }

    // 4. Calculate suggested weights
    const suggestedWeights = calculateSuggestedWeights(correlations, currentWeights);

    // 5. Calculate improvements
    const improvements: Record<string, { current: number; suggested: number; change: string }> =
      {};

    for (const metricId in currentWeights) {
      const current = currentWeights[metricId];
      const suggested = suggestedWeights[metricId];
      const percentChange = ((suggested - current) / current) * 100;

      improvements[metricId] = {
        current,
        suggested,
        change: `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`,
      };
    }

    // 6. Generate summary
    const totalCurrentWeight = Object.values(currentWeights).reduce((sum, val) => sum + val, 0);
    const totalSuggestedWeight = Object.values(suggestedWeights).reduce(
      (sum, val) => sum + val,
      0
    );
    const avgCorrelation = mean(Object.values(correlations));

    // Sort by absolute correlation
    const sortedByCorr = Object.entries(correlations)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .map(([id]) => id);

    const result: OptimizationResult = {
      timestamp: new Date().toISOString(),
      daysAnalyzed: days,
      targetMetric,
      currentWeights,
      suggestedWeights,
      correlations,
      improvements,
      summary: {
        totalCurrentWeight,
        totalSuggestedWeight,
        avgCorrelation,
        topPerformers: sortedByCorr.slice(0, 3),
        bottomPerformers: sortedByCorr.slice(-3),
      },
    };

    // 7. Save results
    const outputDir = path.join(process.cwd(), 'optimization-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `weight-optimization_${new Date().toISOString().split('T')[0]}.json`;
    const outputPath = path.join(outputDir, filename);

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        outputPath,
        avgCorrelation: avgCorrelation.toFixed(4),
        topPerformers: result.summary.topPerformers,
      },
      'Weight optimization completed'
    );

    // 8. Print summary to console
    console.log('\n=== WEIGHT OPTIMIZATION RESULTS ===\n');
    console.log(`Target Metric: ${targetMetric.toUpperCase()}`);
    console.log(`Days Analyzed: ${days}`);
    console.log(`Average Correlation: ${avgCorrelation.toFixed(4)}\n`);

    console.log('Top Performers (by correlation):');
    result.summary.topPerformers.forEach((id, i) => {
      const corr = correlations[id];
      const current = currentWeights[id];
      const suggested = suggestedWeights[id];
      console.log(
        `  ${i + 1}. ${id}: corr=${corr.toFixed(4)}, weight ${current.toFixed(2)} → ${suggested.toFixed(2)}`
      );
    });

    console.log('\nBottom Performers (by correlation):');
    result.summary.bottomPerformers.forEach((id, i) => {
      const corr = correlations[id];
      const current = currentWeights[id];
      const suggested = suggestedWeights[id];
      console.log(
        `  ${i + 1}. ${id}: corr=${corr.toFixed(4)}, weight ${current.toFixed(2)} → ${suggested.toFixed(2)}`
      );
    });

    console.log(`\nResults saved to: ${outputPath}\n`);
  } catch (error) {
    logger.fatal({ error }, 'Weight optimization failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let days = 365;
  let targetMetric: 'pxi' | 'regime' = 'pxi';

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--target=')) {
      const target = arg.split('=')[1];
      if (target === 'pxi' || target === 'regime') {
        targetMetric = target;
      }
    }
  }

  try {
    await optimizeWeights(days, targetMetric);
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in weight optimization');
    await closePool();
    process.exit(1);
  }
}

// Run the optimizer
main();
