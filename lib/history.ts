import { pool } from '../db.js';
import { pxiMetricDefinitions } from '../shared/pxiMetrics.js';

export const REQUIRED_METRIC_IDS = pxiMetricDefinitions.map((def) => def.id);

export interface HistoricalMetric {
  date: string;
  indicatorId: string;
  value: number | null;
  mean: number | null;
  stddev: number | null;
}

/**
 * Return ISO date strings (YYYY-MM-DD) that have history coverage
 */
export async function fetchAvailableHistoryDates(daysBack: number = 30): Promise<string[]> {
  const result = await pool.query<{ date: Date }>(
    `SELECT DISTINCT date
     FROM history_values
     WHERE date >= NOW() - INTERVAL '${daysBack} days'
     ORDER BY date DESC`,
  );

  return result.rows.map((row) => {
    const iso = row.date.toISOString();
    return iso.split('T')[0];
  });
}

/**
 * Fetch the historical metric snapshot for a given day (value + stats)
 */
export async function fetchHistoricalMetricsForDate(date: string): Promise<Record<string, HistoricalMetric>> {
  const result = await pool.query<HistoricalMetric>(
    `SELECT
        hv.indicator_id as "indicatorId",
        hv.date::text,
        hv.raw_value as value,
        stats.mean_value as mean,
        stats.stddev_value as stddev
     FROM history_values hv
     LEFT JOIN LATERAL (
       SELECT mean_value, stddev_value
       FROM stats_values sv
       WHERE sv.indicator_id = hv.indicator_id
         AND sv.date <= hv.date
       ORDER BY sv.date DESC
       LIMIT 1
     ) stats ON TRUE
     WHERE hv.date = $1`,
    [date],
  );

  const metrics: Record<string, HistoricalMetric> = {};
  for (const row of result.rows) {
    metrics[row.indicatorId] = row;
  }
  return metrics;
}

/**
 * Ensure all required metrics exist for a snapshot
 */
export function hasAllRequiredMetrics(
  metrics: Record<string, HistoricalMetric>,
  required: string[] = REQUIRED_METRIC_IDS,
): { ok: boolean; missing: string[] } {
  const missing = required.filter((id) => !metrics[id]);
  return { ok: missing.length === 0, missing };
}
