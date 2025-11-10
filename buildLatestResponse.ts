import { fetchLatestComposites, fetchLatestAlerts, fetchLatestRegime } from './db.js';
import {
  classifyMetricState,
  pxiBands,
  pxiMetricDefinitions,
  type MetricRow,
  type PXIResponse,
  type Alert,
  type Regime,
} from './shared/index.js';

const definitionMap = new Map(pxiMetricDefinitions.map((def) => [def.id, def]));

export const buildLatestResponse = async (): Promise<PXIResponse | null> => {
  const [latest, previous] = await fetchLatestComposites(2);
  if (!latest) {
    return null;
  }
  const prevMap = new Map(previous?.metrics?.map((metric) => [metric.id, metric]) ?? []);

  const metrics: MetricRow[] = latest.metrics.map((metric) => {
    const def = definitionMap.get(metric.id);
    if (!def) {
      throw new Error(`Missing definition for metric ${metric.id}`);
    }
    const prev = prevMap.get(metric.id);
    const delta = prev ? metric.value - prev.value : 0;
    const breach = classifyMetricState(metric.zScore);
    return {
      id: metric.id,
      label: def.label,
      value: metric.value,
      delta,
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

  const response: PXIResponse = {
    pxi: latest.pxi,
    statusLabel: `${band.label} - ${latest.pxi.toFixed(1)}`,
    zScore: latest.zScore,
    calculatedAt: latest.calculatedAt,
    metrics,
    ticker,
    alerts: alertsFormatted.length > 0 ? alertsFormatted : undefined,
    regime,
  };
  return response;
};
