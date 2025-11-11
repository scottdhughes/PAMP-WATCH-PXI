import { fetchLatestComposites, fetchLatestAlerts, fetchLatestRegime, fetchHistoricalMetricValue, pool } from './db.js';
import {
  classifyMetricState,
  pxiBands,
  pxiMetricDefinitions,
  type MetricRow,
  type PXIResponse,
  type Alert,
  type Regime,
  type HealthStatus,
} from './shared/index.js';
import { logger } from './logger.js';
import { sanityCheck, rollingVolatility, stabilityRating } from './validation.js';
import type { PoolClient } from 'pg';

const definitionMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));

// Constants for rolling delta calculations
const LOOKBACK_7D = 7;
const LOOKBACK_30D = 30;
const VALIDATION_WINDOW = 30; // Days of data for validation

/**
 * Fetch historical time series for validation
 */
async function fetchValidationSeries(metricId: string, days: number): Promise<number[]> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT value
       FROM pxi_metric_samples
       WHERE metric_id = $1
         AND source_timestamp >= NOW() - INTERVAL '${days} days'
       ORDER BY source_timestamp ASC`,
      [metricId]
    );
    return result.rows.map((r) => r.value);
  } catch (error) {
    logger.error({ error, metricId }, 'Failed to fetch validation series');
    return [];
  } finally {
    if (client) client.release();
  }
}

/**
 * Calculate percentage change between current and historical value
 * Returns null if historical value is missing or calculation is invalid
 *
 * Special handling for btcReturn: shows difference in percentage points
 * instead of percentage change, since btcReturn is already a change metric
 */
function calculatePercentageChange(currentValue: number, historicalValue: number | null, metricId: string): number | null {
  if (historicalValue === null || !Number.isFinite(historicalValue)) {
    return null;
  }

  // Special case: btcReturn is already a percentage change metric
  // Show the difference in percentage points, not percentage-of-percentage
  if (metricId === 'btcReturn') {
    // Convert to percentage points difference
    // e.g., -2.79% - (+2.51%) = -5.30 percentage points
    const delta = (currentValue - historicalValue) * 100;

    if (!Number.isFinite(delta)) {
      return null;
    }

    return delta;
  }

  // For all other metrics, use standard percentage change formula
  if (historicalValue === 0) {
    return null; // Avoid division by zero
  }

  const delta = ((currentValue - historicalValue) / Math.abs(historicalValue)) * 100;

  // Validate the result
  if (!Number.isFinite(delta)) {
    return null;
  }

  return delta;
}

export const buildLatestResponse = async (): Promise<PXIResponse | null> => {
  const [latest, previous] = await fetchLatestComposites(2);
  if (!latest) {
    return null;
  }
  const prevMap = new Map(previous?.metrics?.map((metric) => [metric.id, metric]) ?? []);

  // Fetch historical values for all metrics in parallel for delta calculations and validation
  const historicalValues7D = new Map<string, number | null>();
  const historicalValues30D = new Map<string, number | null>();
  const validationSeries = new Map<string, number[]>();

  await Promise.all(
    latest.metrics.map(async (metric) => {
      const [value7D, value30D, series] = await Promise.all([
        fetchHistoricalMetricValue(metric.id, LOOKBACK_7D),
        fetchHistoricalMetricValue(metric.id, LOOKBACK_30D),
        fetchValidationSeries(metric.id, VALIDATION_WINDOW),
      ]);
      historicalValues7D.set(metric.id, value7D);
      historicalValues30D.set(metric.id, value30D);
      validationSeries.set(metric.id, series);
    })
  );

  const metrics: MetricRow[] = latest.metrics.map((metric) => {
    const def = definitionMap.get(metric.id);
    if (!def) {
      throw new Error(`Missing definition for metric ${metric.id}`);
    }
    const prev = prevMap.get(metric.id);
    const delta = prev ? metric.value - prev.value : 0;

    // Calculate rolling deltas
    const value7D = historicalValues7D.get(metric.id) ?? null;
    const value30D = historicalValues30D.get(metric.id) ?? null;

    const delta7D = calculatePercentageChange(metric.value, value7D, metric.id);
    const delta30D = calculatePercentageChange(metric.value, value30D, metric.id);

    if (delta7D !== null || delta30D !== null) {
      logger.debug(
        { metric: metric.id, value: metric.value, value7D, value30D, delta7D, delta30D },
        'Calculated rolling deltas'
      );
    }

    // Run validation and health checks
    const series = validationSeries.get(metric.id) || [];
    const validation = sanityCheck(series, metric.id, 3, 5);
    const volatility = rollingVolatility(series, 30);
    const stability = stabilityRating(volatility);

    // Determine health status
    let health: HealthStatus = 'OK';
    if (validation.isInvalid) {
      health = 'Invalid';
    } else if (validation.isFlat) {
      health = 'Flat';
    } else if (validation.isOutlier) {
      health = 'Outlier';
    } else if (series.length < 5) {
      health = 'Stale';
    }

    if (health !== 'OK') {
      logger.warn(
        { metric: metric.id, health, reason: validation.reason, volatility, stability },
        'Metric health check warning'
      );
    }

    const breach = classifyMetricState(metric.zScore);
    return {
      id: metric.id,
      label: def.label,
      value: metric.value,
      delta,
      delta7D,
      delta30D,
      lower: def.lowerBound,
      upper: def.upperBound,
      zScore: metric.zScore,
      contribution: metric.contribution,
      breach,
      health,
      volatility: volatility ?? undefined,
      stability,
    };
  });

  const band =
    pxiBands.find((candidate) => latest.pxi >= candidate.min && latest.pxi < candidate.max) ??
    pxiBands[pxiBands.length - 1];

  const ticker: string[] = [
    ...latest.breaches.pamp.map((id) => `${definitionMap.get(id)?.label ?? id} - PAMP`),
    ...latest.breaches.stress.map((id) => `${definitionMap.get(id)?.label ?? id} - Stress`),
  ];
  if (latest.breaches.systemLevel) {
    ticker.push(`System Breach - ${latest.breaches.systemLevel}`);
  }

  // Fetch enhanced data (alerts and regime)
  const [alerts, regimeData] = await Promise.all([
    fetchLatestAlerts(5, true).catch(() => []), // Fetch up to 5 unacknowledged alerts
    fetchLatestRegime().catch(() => null),
  ]);

  // Transform alerts to API format
  const alertsFormatted: Alert[] = alerts.map((alert) => ({
    id: alert.id,
    alertType: alert.alertType,
    indicatorId: alert.indicatorId,
    timestamp: alert.timestamp,
    rawValue: alert.rawValue,
    zScore: alert.zScore,
    message: alert.message,
    severity: alert.severity,
  }));

  // Transform regime to API format
  const regime: Regime | undefined = regimeData
    ? {
        regime: regimeData.regime,
        pxiValue: regimeData.pxiValue,
        totalWeight: regimeData.totalWeight,
        pampCount: regimeData.pampCount,
        stressCount: regimeData.stressCount,
      }
    : undefined;

  // Use actual regime name instead of bands (PXI is z-score, not 0-100)
  const regimeName = regime?.regime || band.label;
  const pxiDisplay = latest.pxi >= 0 ? `+${latest.pxi.toFixed(2)}` : latest.pxi.toFixed(2);

  // Generate version string for change detection (use ISO timestamp)
  const version = new Date().toISOString();

  const response: PXIResponse = {
    pxi: latest.pxi,
    statusLabel: `${regimeName} – ${pxiDisplay}`,
    zScore: latest.zScore,
    calculatedAt: latest.calculatedAt,
    metrics,
    ticker,
    alerts: alertsFormatted.length > 0 ? alertsFormatted : undefined,
    regime,
    version,
  };
  return response;
};
