#!/usr/bin/env node
/**
 * Development helper script that seeds deterministic PXI metric samples
 * so the full validation suite can run without calling external APIs.
 *
 * Usage:
 *   npx tsx scripts/seed-validation-data.ts
 */

import { pool, closePool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';
import type { MetricId } from '../shared/types.js';

const METRIC_CONFIG: Record<MetricId, { unit: string; base: number; step: number; amplitude: number; period: number }> = {
  hyOas: { unit: 'percent', base: 0.045, step: 0.0002, amplitude: 0.002, period: 4 },
  igOas: { unit: 'percent', base: 0.025, step: 0.00015, amplitude: 0.001, period: 5 },
  vix: { unit: 'index', base: 18, step: 0.12, amplitude: 1.5, period: 4 },
  u3: { unit: 'percent', base: 0.04, step: 0.0001, amplitude: 0.001, period: 7 },
  usd: { unit: 'index', base: 105, step: 0.08, amplitude: 1.2, period: 8 },
  nfci: { unit: 'index', base: 0.0, step: 0.01, amplitude: 0.15, period: 5 },
  btcReturn: { unit: 'percent', base: 0, step: 0.002, amplitude: 0.02, period: 3 },
  yc_10y_2y: { unit: 'percent', base: -0.25, step: 0.01, amplitude: 0.2, period: 4 },
  stlfsi: { unit: 'index', base: -0.3, step: 0.02, amplitude: 0.25, period: 5 },
  breakeven10y: { unit: 'percent', base: 0.021, step: 0.0001, amplitude: 0.0008, period: 6 },
};

const DAYS_TO_SEED = Number(process.env.SEED_DAYS ?? 30);

function classifyRegimeFromValue(pxiValue: number): string {
  if (pxiValue > 2.0) return 'Strong PAMP';
  if (pxiValue > 1.0) return 'Moderate PAMP';
  if (pxiValue >= -1.0) return 'Normal';
  if (pxiValue >= -2.0) return 'Elevated Stress';
  return 'Crisis';
}

interface SamplePoint {
  timestamp: Date;
  value: number;
  zScore: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function generateSeries(metricId: MetricId): SamplePoint[] {
  const config = METRIC_CONFIG[metricId];
  if (!config) {
    throw new Error(`No seed config defined for ${metricId}`);
  }

  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (DAYS_TO_SEED - 1));

  const samples: SamplePoint[] = [];
  for (let day = 0; day < DAYS_TO_SEED; day++) {
    const timestamp = new Date(start.getTime() + day * MS_PER_DAY);
    const wave = Math.sin((day + 1) / config.period);
    const value = Number((config.base + config.step * day + config.amplitude * wave).toFixed(6));
    samples.push({ timestamp, value, zScore: 0 });
  }

  const mean = samples.reduce((sum, point) => sum + point.value, 0) / samples.length;
  const variance =
    samples.reduce((sum, point) => sum + Math.pow(point.value - mean, 2), 0) /
    Math.max(samples.length - 1, 1);
  const stddev = variance < 1e-12 ? 1e-6 : Math.sqrt(variance);

  samples.forEach((point) => {
    point.zScore = (point.value - mean) / stddev;
  });

  return samples;
}

async function seedValidationData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE composite_pxi_regime, pxi_metric_samples, z_scores, contributions, history_values, alerts, pxi_composites RESTART IDENTITY CASCADE');

    const rows: string[] = [];
    const values: Array<string | number | object> = [];
    let paramIndex = 1;

    const metricSeries = new Map<MetricId, SamplePoint[]>();

    for (const def of pxiMetricDefinitions) {
      const series = generateSeries(def.id);
      metricSeries.set(def.id, series);
      const config = METRIC_CONFIG[def.id];

      for (const sample of series) {
        rows.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
        );
        values.push(
          def.id,
          def.label,
          sample.value,
          config.unit,
          sample.timestamp.toISOString(),
          sample.timestamp.toISOString(),
          {},
          sample.zScore,
        );
      }
    }

    await client.query(
      `
      INSERT INTO pxi_metric_samples
        (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata, z_score)
      VALUES
        ${rows.join(', ')}
      `,
      values,
    );

    // Build composite PXI entry for the most recent timestamp
    const latestTimestamp = metricSeries.get('hyOas')!.at(-1)!.timestamp;
    const totalWeight = pxiMetricDefinitions
      .filter((def) => def.weight > 0)
      .reduce((sum, def) => sum + def.weight, 0);

    let weightedSum = 0;
    let pampCount = 0;
    let stressCount = 0;

    for (const def of pxiMetricDefinitions) {
      const latestSample = metricSeries.get(def.id)!.at(-1)!;
      if (latestSample.zScore > 2) pampCount++;
      if (latestSample.zScore < -2) stressCount++;

      if (def.weight === 0) continue;
      const polarityMultiplier = def.polarity === 'positive' ? 1 : -1;
      weightedSum += def.weight * latestSample.zScore * polarityMultiplier;
    }

    const compositeValue = weightedSum / totalWeight;
    const regime = classifyRegimeFromValue(compositeValue);

    await client.query(
      `
      INSERT INTO composite_pxi_regime
        (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count, raw_pxi_value)
      VALUES
        ($1, $2, $2, $3, $4, $5, $6, $2)
      ON CONFLICT (timestamp)
      DO UPDATE SET
        pxi_value = EXCLUDED.pxi_value,
        pxi_z_score = EXCLUDED.pxi_z_score,
        regime = EXCLUDED.regime,
        raw_pxi_value = EXCLUDED.raw_pxi_value
      `,
      [
        latestTimestamp.toISOString(),
        compositeValue,
        regime,
        totalWeight,
        pampCount,
        stressCount,
      ],
    );

    await client.query('COMMIT');
    console.log(`Seeded ${pxiMetricDefinitions.length} metrics over ${DAYS_TO_SEED} days for validation.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to seed validation data', error);
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

seedValidationData().catch((error) => {
  console.error(error);
  process.exit(1);
});
