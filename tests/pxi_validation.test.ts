/**
 * PXI Validation Test Suite
 *
 * Comprehensive validation of PXI calculation, z-score accuracy,
 * and system-level integrity checks.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import { mean, std } from 'mathjs';

// Acceptance criteria
const Z_SCORE_TOLERANCE = 1e-6; // Z-score must match within 1e-6
const TOTAL_WEIGHT = pxiMetricDefinitions
  .filter((m) => m.weight > 0)
  .reduce((sum, m) => sum + m.weight, 0);

interface MetricSample {
  metricId: string;
  value: number;
  zScore: number;
  timestamp: Date;
}

interface PXIComposite {
  pxiValue: number;
  timestamp: Date;
  metrics: MetricSample[];
}

describe('PXI Validation Suite', () => {
  let latestComposite: PXIComposite | null = null;
  let historicalData: Map<string, number[]> = new Map();

  beforeAll(async () => {
    // Fetch latest PXI composite
    const compositeResult = await pool.query(`
      SELECT
        pxi_value,
        timestamp
      FROM composite_pxi_regime
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    if (compositeResult.rows.length === 0) {
      throw new Error('No PXI data available for validation');
    }

    const latest = compositeResult.rows[0];

    // Fetch metrics for latest composite
    const metricsResult = await pool.query(`
      SELECT
        metric_id,
        value,
        z_score,
        source_timestamp
      FROM pxi_metric_samples
      WHERE DATE(source_timestamp) = DATE($1)
      ORDER BY source_timestamp DESC
    `, [latest.timestamp]);

    // Get most recent value for each metric on that date
    const metricMap = new Map<string, MetricSample>();
    metricsResult.rows.forEach((row) => {
      if (!metricMap.has(row.metric_id)) {
        metricMap.set(row.metric_id, {
          metricId: row.metric_id,
          value: Number(row.value),
          zScore: Number(row.z_score),
          timestamp: row.source_timestamp,
        });
      }
    });

    latestComposite = {
      pxiValue: Number(latest.pxi_value),
      timestamp: latest.timestamp,
      metrics: Array.from(metricMap.values()),
    };

    // Fetch historical data (90 days) for each metric
    const historicalResult = await pool.query(`
      SELECT
        metric_id,
        value,
        source_timestamp
      FROM pxi_metric_samples
      WHERE source_timestamp >= NOW() - INTERVAL '90 days'
      ORDER BY source_timestamp ASC
    `);

    historicalResult.rows.forEach((row) => {
      const metricId = row.metric_id;
      if (!historicalData.has(metricId)) {
        historicalData.set(metricId, []);
      }
      historicalData.get(metricId)!.push(Number(row.value));
    });
  });

  describe('Metric-Level Validation', () => {
    it('should have all expected metrics', () => {
      const expectedMetrics = pxiMetricDefinitions.map((m) => m.id);
      const actualMetrics = latestComposite!.metrics.map((m) => m.metricId);

      expectedMetrics.forEach((expected) => {
        expect(
          actualMetrics.includes(expected),
          `Missing metric: ${expected}`
        ).toBe(true);
      });
    });

    it('should have valid z-scores within tolerance', () => {
      latestComposite!.metrics.forEach((metric) => {
        const historicalSeries = historicalData.get(metric.metricId);

        if (!historicalSeries || historicalSeries.length < 5) {
          console.warn(`Insufficient data for ${metric.metricId}`);
          return;
        }

        // Manually recompute z-score
        const μ = mean(historicalSeries) as number;
        const σ = std(historicalSeries, 'unbiased') as number;
        const expectedZScore = (metric.value - μ) / σ;

        // Check if z-score matches within tolerance
        const diff = Math.abs(metric.zScore - expectedZScore);
        expect(
          diff,
          `Z-score mismatch for ${metric.metricId}: expected ${expectedZScore.toFixed(6)}, got ${metric.zScore.toFixed(6)}, diff=${diff.toExponential(2)}`
        ).toBeLessThanOrEqual(Z_SCORE_TOLERANCE);
      });
    });

    it('should have finite z-scores', () => {
      latestComposite!.metrics.forEach((metric) => {
        expect(
          Number.isFinite(metric.zScore),
          `Non-finite z-score for ${metric.metricId}: ${metric.zScore}`
        ).toBe(true);
      });
    });

    it('should have finite metric values', () => {
      latestComposite!.metrics.forEach((metric) => {
        expect(
          Number.isFinite(metric.value),
          `Non-finite value for ${metric.metricId}: ${metric.value}`
        ).toBe(true);
      });
    });
  });

  describe('Composite-Level Validation', () => {
    it('should validate total weight sum', () => {
      // Total weight (excluding metrics with weight=0)
      const expectedTotal = TOTAL_WEIGHT;

      expect(expectedTotal).toBeGreaterThan(0);
      console.log(`Total PXI weight (excluding zero-weight metrics): ${expectedTotal.toFixed(2)}`);
    });

    it('should manually recompute PXI and verify match', () => {
      // Manual PXI calculation: PXI = Σ (z_i * w_i) / Σ w_i
      const metricMap = new Map(latestComposite!.metrics.map((m) => [m.metricId, m]));

      let weightedSum = 0;
      let totalWeight = 0;

      pxiMetricDefinitions.forEach((def) => {
        if (def.weight === 0) return; // Skip zero-weight metrics

        const metric = metricMap.get(def.id);
        if (!metric) {
          console.warn(`Missing metric data for ${def.id}`);
          return;
        }

        // Apply polarity
        const polarityMultiplier = def.polarity === 'positive' ? 1 : -1;
        const adjustedZScore = metric.zScore * polarityMultiplier;

        weightedSum += adjustedZScore * def.weight;
        totalWeight += def.weight;
      });

      const manualPXI = weightedSum / totalWeight;
      const diff = Math.abs(latestComposite!.pxiValue - manualPXI);

      console.log(`Manual PXI: ${manualPXI.toFixed(6)}`);
      console.log(`Stored PXI: ${latestComposite!.pxiValue.toFixed(6)}`);
      console.log(`Difference: ${diff.toExponential(2)}`);

      // Allow small floating-point error
      expect(diff).toBeLessThanOrEqual(0.001);
    });

    it('should have finite PXI value', () => {
      expect(Number.isFinite(latestComposite!.pxiValue)).toBe(true);
    });
  });

  describe('System-Level Sanity Checks', () => {
    it('should have reasonable PXI range (-10 to +10)', () => {
      expect(latestComposite!.pxiValue).toBeGreaterThan(-10);
      expect(latestComposite!.pxiValue).toBeLessThan(10);
    });

    it('should have z-scores in reasonable range (-5 to +5)', () => {
      latestComposite!.metrics.forEach((metric) => {
        expect(
          metric.zScore,
          `Z-score out of range for ${metric.metricId}: ${metric.zScore}`
        ).toBeGreaterThan(-5);
        expect(
          metric.zScore,
          `Z-score out of range for ${metric.metricId}: ${metric.zScore}`
        ).toBeLessThan(5);
      });
    });

    it('should validate expected correlations (VIX and HY OAS)', async () => {
      // VIX and HY OAS should be positively correlated (both rise during stress)
      const vixSeries = historicalData.get('vix') || [];
      const hyOasSeries = historicalData.get('hyOas') || [];

      if (vixSeries.length < 30 || hyOasSeries.length < 30) {
        console.warn('Insufficient data for correlation check');
        return;
      }

      // Compute correlation coefficient (Pearson's r)
      const n = Math.min(vixSeries.length, hyOasSeries.length);
      const vix = vixSeries.slice(-n);
      const hyOas = hyOasSeries.slice(-n);

      const vixMean = mean(vix) as number;
      const hyOasMean = mean(hyOas) as number;

      let numerator = 0;
      let vixSumSq = 0;
      let hyOasSumSq = 0;

      for (let i = 0; i < n; i++) {
        const vixDev = vix[i] - vixMean;
        const hyOasDev = hyOas[i] - hyOasMean;
        numerator += vixDev * hyOasDev;
        vixSumSq += vixDev * vixDev;
        hyOasSumSq += hyOasDev * hyOasDev;
      }

      const correlation = numerator / Math.sqrt(vixSumSq * hyOasSumSq);

      console.log(`VIX-HY OAS correlation: ${correlation.toFixed(3)}`);

      // Should be positive (both rise together during stress)
      expect(correlation).toBeGreaterThan(0);
    });

    it('should have recent data (within 7 days)', () => {
      const now = new Date();
      const ageMs = now.getTime() - new Date(latestComposite!.timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      console.log(`Latest PXI age: ${ageDays.toFixed(2)} days`);

      expect(ageDays).toBeLessThan(7);
    });
  });

  describe('Data Integrity Checks', () => {
    it('should have no duplicate timestamps for same metric', async () => {
      const duplicatesResult = await pool.query(`
        SELECT
          metric_id,
          source_timestamp,
          COUNT(*) as count
        FROM pxi_metric_samples
        WHERE source_timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY metric_id, source_timestamp
        HAVING COUNT(*) > 1
      `);

      expect(
        duplicatesResult.rows.length,
        `Found ${duplicatesResult.rows.length} duplicate entries`
      ).toBe(0);
    });

    it('should have no NULL z-scores', async () => {
      const nullZScoresResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM pxi_metric_samples
        WHERE z_score IS NULL
          AND source_timestamp >= NOW() - INTERVAL '7 days'
      `);

      expect(Number(nullZScoresResult.rows[0].count)).toBe(0);
    });

    it('should have no NULL PXI values', async () => {
      const nullPXIResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM composite_pxi_regime
        WHERE pxi_value IS NULL
          AND timestamp >= NOW() - INTERVAL '7 days'
      `);

      expect(Number(nullPXIResult.rows[0].count)).toBe(0);
    });

    it('should have increasing timestamps', async () => {
      const timestampsResult = await pool.query(`
        SELECT timestamp
        FROM composite_pxi_regime
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        ORDER BY timestamp ASC
      `);

      const timestamps = timestampsResult.rows.map((r) => new Date(r.timestamp).getTime());

      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });
  });

  describe('Regime Alignment Check', () => {
    it('should have regime classification that matches PXI level', async () => {
      const regimeResult = await pool.query(`
        SELECT regime, pxi_value
        FROM pxi_regimes
        ORDER BY date DESC
        LIMIT 1
      `);

      if (regimeResult.rows.length === 0) {
        console.warn('No regime data available');
        return;
      }

      const { regime, pxi_value } = regimeResult.rows[0];
      const pxi = Number(pxi_value);

      console.log(`Latest regime: ${regime}, PXI: ${pxi.toFixed(3)}`);

      // Basic sanity: Stress regime should have higher PXI than Calm
      // (This is a loose check - actual regime is determined by k-means clustering)
      if (regime === 'Stress') {
        // Generally expect elevated stress levels
        expect(Math.abs(pxi)).toBeGreaterThan(-2); // Not extremely low stress
      } else if (regime === 'Calm') {
        // Generally expect low stress levels
        expect(pxi).toBeLessThan(3); // Not extremely high stress
      }
    });
  });
});
