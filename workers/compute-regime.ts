#!/usr/bin/env node
/**
 * K-Means Regime Detection Worker
 *
 * Implements regime detection using k-means clustering (k=3, seeded)
 * with feature vectors built from z-scores and rolling volatilities.
 */

import { kmeans } from 'ml-kmeans';
import { pool, closePool } from '../db.js';
import { logger } from '../logger.js';

// Feature metrics to use in clustering
// Note: stlfsi excluded temporarily due to insufficient historical stats
const FEATURE_METRICS = [
  'hyOas',
  'igOas',
  'vix',
  'nfci',
  'usd',
  'yc_10y_2y',
] as const;

interface MetricDataPoint {
  date: string;
  metricId: string;
  value: number;
  zScore: number;
}

interface DailyFeatures {
  date: string;
  features: number[];
  featureNames: string[];
  rawMetrics: Record<string, { value: number; zScore: number }>;
  pxiValue: number;
  pxiZScore: number;
}

/**
 * Query historical metric data with z-scores from history_values and stats_values
 */
async function queryMetricData(days: number = 90): Promise<MetricDataPoint[]> {
  const query = `
    SELECT
      h.date::text,
      h.indicator_id as metric_id,
      h.raw_value as value,
      CASE
        WHEN s.stddev_value > 0 THEN (h.raw_value - s.mean_value) / s.stddev_value
        ELSE 0
      END as z_score
    FROM history_values h
    INNER JOIN stats_values s
      ON h.indicator_id = s.indicator_id AND h.date = s.date
    WHERE h.date >= CURRENT_DATE - INTERVAL '${days} days'
      AND h.indicator_id = ANY($1::text[])
      AND s.stddev_value IS NOT NULL
      AND s.sample_count >= 30
    ORDER BY h.date DESC, h.indicator_id;
  `;

  const result = await pool.query(query, [FEATURE_METRICS]);

  return result.rows.map((row) => ({
    date: row.date,
    metricId: row.metric_id,
    value: Number(row.value),
    zScore: Number(row.z_score),
  }));
}

/**
 * Query PXI composite data
 */
async function queryPxiData(days: number = 90): Promise<Array<{ date: string; pxiValue: number; pxiZScore: number }>> {
  const query = `
    SELECT
      DATE(timestamp)::text as date,
      pxi_value,
      pxi_z_score
    FROM composite_pxi_regime
    WHERE timestamp >= NOW() - INTERVAL '${days} days'
    ORDER BY date DESC;
  `;

  const result = await pool.query(query);

  return result.rows.map((row) => ({
    date: row.date,
    pxiValue: Number(row.pxi_value),
    pxiZScore: Number(row.pxi_z_score),
  }));
}

/**
 * Calculate 30-day rolling volatility for each metric
 */
function calculateRollingVolatility(
  data: MetricDataPoint[],
  metricId: string,
  windowDays: number = 30,
): Map<string, number> {
  // Group by date, sorted chronologically
  const metricData = data
    .filter((d) => d.metricId === metricId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const volatilityMap = new Map<string, number>();

  for (let i = 0; i < metricData.length; i++) {
    const windowStart = Math.max(0, i - windowDays + 1);
    const windowValues = metricData.slice(windowStart, i + 1).map((d) => d.value);

    if (windowValues.length < 5) {
      // Skip if insufficient data
      continue;
    }

    // Calculate standard deviation as volatility
    const mean = windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length;
    const variance = windowValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (windowValues.length - 1);
    const volatility = Math.sqrt(variance);

    volatilityMap.set(metricData[i].date, volatility);
  }

  return volatilityMap;
}

/**
 * Build feature matrix for k-means clustering
 */
function buildFeatureMatrix(
  metricData: MetricDataPoint[],
  pxiData: Array<{ date: string; pxiValue: number; pxiZScore: number }>,
): DailyFeatures[] {
  // Calculate volatilities for each metric
  const volatilities = new Map<string, Map<string, number>>();
  for (const metricId of FEATURE_METRICS) {
    volatilities.set(metricId, calculateRollingVolatility(metricData, metricId, 30));
  }

  // Group metric data by date
  const dateMap = new Map<string, Map<string, MetricDataPoint>>();
  for (const point of metricData) {
    if (!dateMap.has(point.date)) {
      dateMap.set(point.date, new Map());
    }
    dateMap.get(point.date)!.set(point.metricId, point);
  }

  // Build feature vectors for each date
  const dailyFeatures: DailyFeatures[] = [];

  for (const pxiPoint of pxiData) {
    const { date, pxiValue, pxiZScore } = pxiPoint;
    const metricsForDate = dateMap.get(date);

    if (!metricsForDate) {
      continue; // Skip dates without metric data
    }

    const features: number[] = [];
    const featureNames: string[] = [];
    const rawMetrics: Record<string, { value: number; zScore: number }> = {};

    // Add z-scores and volatilities for each metric
    for (const metricId of FEATURE_METRICS) {
      const metricPoint = metricsForDate.get(metricId);
      const volatilityMap = volatilities.get(metricId);

      if (!metricPoint || !volatilityMap || !volatilityMap.has(date)) {
        // Skip this date if any metric is missing
        continue;
      }

      const volatility = volatilityMap.get(date)!;

      // Add z-score
      features.push(metricPoint.zScore);
      featureNames.push(`${metricId}_zscore`);

      // Add volatility
      features.push(volatility);
      featureNames.push(`${metricId}_volatility`);

      // Store raw metrics for debugging
      rawMetrics[metricId] = {
        value: metricPoint.value,
        zScore: metricPoint.zScore,
      };
    }

    // Only include complete feature vectors
    if (features.length === FEATURE_METRICS.length * 2) {
      dailyFeatures.push({
        date,
        features,
        featureNames,
        rawMetrics,
        pxiValue,
        pxiZScore,
      });
    }
  }

  return dailyFeatures.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Run k-means clustering with k=3, seed=42
 */
function runKMeans(featureMatrix: number[][], k: number = 3, seed: number = 42): {
  clusters: number[];
  centroids: number[][];
} {
  const result = kmeans(featureMatrix, k, { seed });

  return {
    clusters: result.clusters,
    centroids: result.centroids,
  };
}

/**
 * Label clusters as Calm/Normal/Stress based on VIX + HY OAS centroids
 */
function labelClusters(
  centroids: number[][],
  featureNames: string[],
): Map<number, 'Calm' | 'Normal' | 'Stress'> {
  // Find indices for VIX and HY OAS z-scores
  const vixZScoreIdx = featureNames.indexOf('vix_zscore');
  const hyOasZScoreIdx = featureNames.indexOf('hyOas_zscore');

  if (vixZScoreIdx === -1 || hyOasZScoreIdx === -1) {
    throw new Error('VIX or HY OAS z-score not found in features');
  }

  // Calculate stress score for each cluster (higher VIX + HY OAS = more stress)
  const clusterStressScores = centroids.map((centroid, idx) => ({
    clusterId: idx,
    stressScore: centroid[vixZScoreIdx] + centroid[hyOasZScoreIdx],
  }));

  // Sort by stress score
  clusterStressScores.sort((a, b) => a.stressScore - b.stressScore);

  // Label: lowest stress = Calm, middle = Normal, highest = Stress
  const labels = new Map<number, 'Calm' | 'Normal' | 'Stress'>();
  labels.set(clusterStressScores[0].clusterId, 'Calm');
  labels.set(clusterStressScores[1].clusterId, 'Normal');
  labels.set(clusterStressScores[2].clusterId, 'Stress');

  logger.info({
    clusterLabels: {
      [clusterStressScores[0].clusterId]: `Calm (stress: ${clusterStressScores[0].stressScore.toFixed(2)})`,
      [clusterStressScores[1].clusterId]: `Normal (stress: ${clusterStressScores[1].stressScore.toFixed(2)})`,
      [clusterStressScores[2].clusterId]: `Stress (stress: ${clusterStressScores[2].stressScore.toFixed(2)})`,
    },
  }, 'K-means cluster labeling complete');

  return labels;
}

/**
 * Calculate distances to each cluster centroid
 */
function calculateDistances(features: number[], centroids: number[][]): number[] {
  return centroids.map((centroid) => {
    const squaredDiffs = features.map((f, i) => Math.pow(f - centroid[i], 2));
    return Math.sqrt(squaredDiffs.reduce((sum, d) => sum + d, 0));
  });
}

/**
 * Persist regime results to database
 */
async function persistRegimes(
  dailyFeatures: DailyFeatures[],
  clusters: number[],
  centroids: number[][],
  clusterLabels: Map<number, 'Calm' | 'Normal' | 'Stress'>,
): Promise<void> {
  const query = `
    INSERT INTO pxi_regimes (date, regime, cluster_id, features, centroid, probabilities)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (date)
    DO UPDATE SET
      regime = EXCLUDED.regime,
      cluster_id = EXCLUDED.cluster_id,
      features = EXCLUDED.features,
      centroid = EXCLUDED.centroid,
      probabilities = EXCLUDED.probabilities;
  `;

  let inserted = 0;
  for (let i = 0; i < dailyFeatures.length; i++) {
    const { date, features, featureNames, rawMetrics, pxiValue, pxiZScore } = dailyFeatures[i];
    const clusterId = clusters[i];
    const regime = clusterLabels.get(clusterId)!;
    const centroid = centroids[clusterId];
    const distances = calculateDistances(features, centroids);

    const featureObj = Object.fromEntries(
      featureNames.map((name, idx) => [name, features[idx]]),
    );

    const centroidObj = Object.fromEntries(
      featureNames.map((name, idx) => [name, centroid[idx]]),
    );

    const probabilitiesObj = {
      distances,
      rawMetrics,
      pxiValue,
      pxiZScore,
    };

    try {
      await pool.query(query, [
        date,
        regime,
        clusterId,
        JSON.stringify(featureObj),
        JSON.stringify(centroidObj),
        JSON.stringify(probabilitiesObj),
      ]);
      inserted++;
    } catch (error) {
      logger.error({ date, error }, 'Failed to insert regime');
    }
  }

  logger.info({ inserted, total: dailyFeatures.length }, 'Persisted regime data');
}

/**
 * Main regime computation logic
 */
async function computeRegimes(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting k-means regime detection');

  try {
    // 1. Query data
    logger.info('Querying metric data (90 days)');
    const [metricData, pxiData] = await Promise.all([
      queryMetricData(90),
      queryPxiData(90),
    ]);

    logger.info({
      metricDataPoints: metricData.length,
      pxiDataPoints: pxiData.length,
    }, 'Data retrieved');

    // 2. Build feature matrix
    logger.info('Building feature matrix');
    const dailyFeatures = buildFeatureMatrix(metricData, pxiData);

    if (dailyFeatures.length === 0) {
      logger.warn('No complete feature vectors found. Skipping regime detection.');
      return;
    }

    logger.info({
      days: dailyFeatures.length,
      featuresPerDay: dailyFeatures[0].features.length,
      featureNames: dailyFeatures[0].featureNames,
    }, 'Feature matrix built');

    // 3. Run k-means
    logger.info('Running k-means clustering (k=3, seed=42)');
    const featureMatrix = dailyFeatures.map((d) => d.features);

    // Check for NaN/Infinity values
    const hasInvalidValues = featureMatrix.some((row) =>
      row.some((val) => !isFinite(val)),
    );
    if (hasInvalidValues) {
      logger.error('Feature matrix contains NaN or Infinity values');
      throw new Error('Invalid feature matrix');
    }

    const { clusters, centroids } = runKMeans(featureMatrix, 3, 42);

    logger.info({
      clusters: clusters.length,
      centroids: centroids.length,
      distribution: {
        cluster0: clusters.filter((c) => c === 0).length,
        cluster1: clusters.filter((c) => c === 1).length,
        cluster2: clusters.filter((c) => c === 2).length,
      },
    }, 'K-means clustering complete');

    // 4. Label clusters
    logger.info('Labeling clusters');
    const clusterLabels = labelClusters(centroids, dailyFeatures[0].featureNames);

    // 5. Persist results
    logger.info('Persisting regime data');
    await persistRegimes(dailyFeatures, clusters, centroids, clusterLabels);

    const duration = Date.now() - startTime;
    logger.info({ duration, days: dailyFeatures.length }, 'Regime detection complete');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 'Regime detection failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await computeRegimes();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in regime detection');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in regime worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in regime worker');
  process.exit(1);
});

// Run the worker
main();
