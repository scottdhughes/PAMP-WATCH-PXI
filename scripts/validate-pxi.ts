/**
 * PXI Validation Reporting Script
 *
 * Pulls latest 90 days of data, recomputes z-scores and PXI manually,
 * and outputs validation results to JSON log files.
 *
 * Usage:
 *   npx tsx scripts/validate-pxi.ts
 */

import { pool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { mean, std } from 'mathjs';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Configuration
const VALIDATION_WINDOW_DAYS = 90;
const Z_SCORE_TOLERANCE = 1e-6;
const OUTPUT_DIR = 'logs/validation';

interface ValidationResult {
  timestamp: string;
  summary: {
    totalMetrics: number;
    passedMetrics: number;
    failedMetrics: number;
    pxiMatch: boolean;
    totalWeight: number;
  };
  metrics: {
    metricId: string;
    label: string;
    storedValue: number;
    storedZScore: number;
    recomputedZScore: number;
    zScoreDiff: number;
    passed: boolean;
    reason: string | null;
  }[];
  pxi: {
    stored: number;
    recomputed: number;
    diff: number;
    passed: boolean;
  };
  errors: string[];
}

/**
 * Recompute z-score from historical data
 */
function recomputeZScore(
  currentValue: number,
  historicalSeries: number[]
): { zScore: number; μ: number; σ: number } | null {
  if (historicalSeries.length < 5) {
    return null;
  }

  const μ = mean(historicalSeries) as number;
  const σ = std(historicalSeries, 'unbiased') as number;

  if (σ < 1e-9) {
    // Flatline data
    return { zScore: 0, μ, σ };
  }

  const zScore = (currentValue - μ) / σ;
  return { zScore, μ, σ };
}

/**
 * Main validation function
 */
async function validatePXI(): Promise<ValidationResult> {
  const errors: string[] = [];
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Starting PXI validation...`);

  // Fetch latest composite PXI
  const latestCompositeResult = await pool.query(`
    SELECT pxi_value, timestamp
    FROM composite_pxi_regime
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  if (latestCompositeResult.rows.length === 0) {
    throw new Error('No PXI composite data available');
  }

  const { pxi_value: storedPXI, timestamp: pxiTimestamp } = latestCompositeResult.rows[0];

  console.log(`Latest PXI: ${storedPXI} at ${pxiTimestamp}`);

  // Fetch the most recent value for each metric AT OR BEFORE the PXI timestamp
  // This handles metrics with different update frequencies (BTC minutely, VIX daily, U3 monthly)
  const metricsResult = await pool.query(`
    SELECT DISTINCT ON (metric_id)
      metric_id,
      value,
      z_score,
      source_timestamp
    FROM pxi_metric_samples
    WHERE source_timestamp <= $1
    ORDER BY metric_id, source_timestamp DESC
  `, [pxiTimestamp]);

  // Build metric map (now includes timestamp for z-score validation)
  const metricMap = new Map<string, { value: number; zScore: number; timestamp: Date }>();
  metricsResult.rows.forEach((row) => {
    metricMap.set(row.metric_id, {
      value: Number(row.value),
      zScore: Number(row.z_score),
      timestamp: new Date(row.source_timestamp),
    });
  });

  console.log(`Found ${metricMap.size} metrics for validation`);

  // Fetch historical data (90 days) for z-score recomputation
  const historicalResult = await pool.query(`
    SELECT
      metric_id,
      value,
      source_timestamp
    FROM pxi_metric_samples
    WHERE source_timestamp >= NOW() - INTERVAL '${VALIDATION_WINDOW_DAYS} days'
    ORDER BY metric_id, source_timestamp ASC
  `);

  // Build historical data map: metricId -> array of {value, timestamp}
  const historicalData = new Map<string, Array<{ value: number; timestamp: Date }>>();
  historicalResult.rows.forEach((row) => {
    const metricId = row.metric_id;
    if (!historicalData.has(metricId)) {
      historicalData.set(metricId, []);
    }
    historicalData.get(metricId)!.push({
      value: Number(row.value),
      timestamp: new Date(row.source_timestamp),
    });
  });

  console.log(`Loaded historical data for ${historicalData.size} metrics`);

  // Validate each metric
  const metricValidations = [];
  let passedMetrics = 0;
  let failedMetrics = 0;

  for (const def of pxiMetricDefinitions) {
    const metricData = metricMap.get(def.id);

    if (!metricData) {
      errors.push(`Missing metric data for ${def.id}`);
      failedMetrics++;
      metricValidations.push({
        metricId: def.id,
        label: def.label,
        storedValue: NaN,
        storedZScore: NaN,
        recomputedZScore: NaN,
        zScoreDiff: NaN,
        passed: false,
        reason: 'Missing data',
      });
      continue;
    }

    const historicalSeries = historicalData.get(def.id);

    if (!historicalSeries || historicalSeries.length < 5) {
      errors.push(`Insufficient historical data for ${def.id}`);
      failedMetrics++;
      metricValidations.push({
        metricId: def.id,
        label: def.label,
        storedValue: metricData.value,
        storedZScore: metricData.zScore,
        recomputedZScore: NaN,
        zScoreDiff: NaN,
        passed: false,
        reason: 'Insufficient historical data',
      });
      continue;
    }

    // Filter historical series to only include data BEFORE the metric's timestamp
    // This matches the ingestion logic and avoids look-ahead bias
    const metricTimestamp = metricData.timestamp;
    const windowStart = new Date(metricTimestamp);
    windowStart.setDate(windowStart.getDate() - VALIDATION_WINDOW_DAYS);

    const filteredHistory = historicalSeries
      .filter((h) => h.timestamp >= windowStart && h.timestamp < metricTimestamp)
      .map((h) => h.value);

    if (filteredHistory.length < 5) {
      errors.push(`Insufficient filtered historical data for ${def.id} (${filteredHistory.length} points)`);
      failedMetrics++;
      metricValidations.push({
        metricId: def.id,
        label: def.label,
        storedValue: metricData.value,
        storedZScore: metricData.zScore,
        recomputedZScore: NaN,
        zScoreDiff: NaN,
        passed: false,
        reason: `Insufficient filtered historical data (${filteredHistory.length} points)`,
      });
      continue;
    }

    // Recompute z-score using filtered historical data
    const recomputed = recomputeZScore(metricData.value, filteredHistory);

    if (!recomputed) {
      errors.push(`Failed to recompute z-score for ${def.id}`);
      failedMetrics++;
      metricValidations.push({
        metricId: def.id,
        label: def.label,
        storedValue: metricData.value,
        storedZScore: metricData.zScore,
        recomputedZScore: NaN,
        zScoreDiff: NaN,
        passed: false,
        reason: 'Recomputation failed',
      });
      continue;
    }

    // Compare z-scores
    const zScoreDiff = Math.abs(metricData.zScore - recomputed.zScore);
    const passed = zScoreDiff <= Z_SCORE_TOLERANCE;

    if (passed) {
      passedMetrics++;
    } else {
      failedMetrics++;
      errors.push(
        `Z-score mismatch for ${def.id}: stored=${metricData.zScore.toFixed(6)}, recomputed=${recomputed.zScore.toFixed(6)}, diff=${zScoreDiff.toExponential(2)}`
      );
    }

    metricValidations.push({
      metricId: def.id,
      label: def.label,
      storedValue: metricData.value,
      storedZScore: metricData.zScore,
      recomputedZScore: recomputed.zScore,
      zScoreDiff,
      passed,
      reason: passed ? null : `Z-score diff ${zScoreDiff.toExponential(2)} > tolerance`,
    });
  }

  // Recompute PXI manually
  let weightedSum = 0;
  let totalWeight = 0;

  for (const def of pxiMetricDefinitions) {
    if (def.weight === 0) continue; // Skip zero-weight metrics

    const metricData = metricMap.get(def.id);
    if (!metricData) {
      console.warn(`Skipping ${def.id} in PXI calculation (missing data)`);
      continue;
    }

    // Apply polarity
    const polarityMultiplier = def.polarity === 'positive' ? 1 : -1;
    const adjustedZScore = metricData.zScore * polarityMultiplier;

    weightedSum += adjustedZScore * def.weight;
    totalWeight += def.weight;
  }

  const recomputedPXI = weightedSum / totalWeight;
  const pxiDiff = Math.abs(Number(storedPXI) - recomputedPXI);
  const pxiPassed = pxiDiff <= 0.001; // Allow small floating-point error

  if (!pxiPassed) {
    errors.push(
      `PXI mismatch: stored=${storedPXI}, recomputed=${recomputedPXI.toFixed(6)}, diff=${pxiDiff.toExponential(2)}`
    );
  }

  console.log(`Stored PXI: ${storedPXI}`);
  console.log(`Recomputed PXI: ${recomputedPXI.toFixed(6)}`);
  console.log(`Difference: ${pxiDiff.toExponential(2)}`);

  // Build validation result
  const result: ValidationResult = {
    timestamp,
    summary: {
      totalMetrics: pxiMetricDefinitions.length,
      passedMetrics,
      failedMetrics,
      pxiMatch: pxiPassed,
      totalWeight,
    },
    metrics: metricValidations,
    pxi: {
      stored: Number(storedPXI),
      recomputed: recomputedPXI,
      diff: pxiDiff,
      passed: pxiPassed,
    },
    errors,
  };

  return result;
}

/**
 * Main execution
 */
async function main() {
  try {
    const result = await validatePXI();

    // Create output directory if it doesn't exist
    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `pxi_validation_${date}.json`;
    const filepath = join(OUTPUT_DIR, filename);

    // Write JSON output
    writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf8');

    console.log(`\n=== Validation Summary ===`);
    console.log(`Total Metrics: ${result.summary.totalMetrics}`);
    console.log(`Passed: ${result.summary.passedMetrics}`);
    console.log(`Failed: ${result.summary.failedMetrics}`);
    console.log(`PXI Match: ${result.pxi.passed ? 'PASS' : 'FAIL'}`);
    console.log(`Total Weight: ${result.summary.totalWeight.toFixed(2)}`);
    console.log(`\nErrors: ${result.errors.length}`);
    result.errors.forEach((err) => console.log(`  - ${err}`));
    console.log(`\nValidation report saved to: ${filepath}`);

    // Exit with appropriate code
    const exitCode = result.errors.length > 0 ? 1 : 0;
    await pool.end();
    process.exit(exitCode);
  } catch (error) {
    console.error('Validation failed:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
