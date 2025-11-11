import { fetchLatestComposites, fetchLatestAlerts, fetchLatestRegime, fetchHistoricalMetricValue } from './db.js';
import {
  classifyMetricState,
  pxiBands,
  pxiMetricDefinitions,
  type MetricRow,
  type PXIResponse,
  type Alert,
  type Regime,
} from './shared/index.js';
import { logger } from './logger.js';

const definitionMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));

// Constants for rolling delta calculations
const LOOKBACK_7D = 7;
const LOOKBACK_30D = 30;

/**
 * Calculate percentage change between current and historical value
 * Returns null if historical value is missing or calculation is invalid
 */
function calculatePercentageChange(currentValue: number, historicalValue: number | null): number | null {
  if (historicalValue === null || historicalValue === 0 || !Number.isFinite(historicalValue)) {
    return null;
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

  // Fetch historical values for all metrics in parallel for delta calculations
  const historicalValues7D = new Map<string, number | null>();
  const historicalValues30D = new Map<string, number | null>();

  await Promise.all(
    latest.metrics.map(async (metric) => {
      const [value7D, value30D] = await Promise.all([
        fetchHistoricalMetricValue(metric.id, LOOKBACK_7D),
        fetchHistoricalMetricValue(metric.id, LOOKBACK_30D),
      ]);
      historicalValues7D.set(metric.id, value7D);
      historicalValues30D.set(metric.id, value30D);
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

    const delta7D = calculatePercentageChange(metric.value, value7D);
    const delta30D = calculatePercentageChange(metric.value, value30D);

    if (delta7D !== null || delta30D !== null) {
      logger.debug(
        { metric: metric.id, value: metric.value, value7D, value30D, delta7D, delta30D },
        'Calculated rolling deltas'
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

  const response: PXIResponse = {
    pxi: latest.pxi,
    statusLabel: `${regimeName} – ${pxiDisplay}`,
    zScore: latest.zScore,
    calculatedAt: latest.calculatedAt,
    metrics,
    ticker,
    alerts: alertsFormatted.length > 0 ? alertsFormatted : undefined,
    regime,
  };
  return response;
};
