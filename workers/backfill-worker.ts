#!/usr/bin/env node
/**
 * Historical Data Backfill Worker
 *
 * Fetches 10 years of historical data from FRED for all metrics
 * and populates the history_values table.
 * Also computes rolling statistics (mean, stddev) for each day.
 */

import { config } from '../config.js';
import { pool, closePool } from '../db.js';
import { logger } from '../logger.js';

const FRED_METRICS = [
  { id: 'hyOas', seriesId: 'BAMLH0A0HYM2', transform: (v: number) => v / 100 },
  { id: 'igOas', seriesId: 'BAMLC0A4CBBB', transform: (v: number) => v / 100 },
  { id: 'vix', seriesId: 'VIXCLS', transform: (v: number) => v },
  { id: 'u3', seriesId: 'UNRATE', transform: (v: number) => v / 100 },
  { id: 'usd', seriesId: 'DTWEXBGS', transform: (v: number) => v },
  { id: 'nfci', seriesId: 'NFCI', transform: (v: number) => v },
  { id: 'stlfsi', seriesId: 'STLFSI2', transform: (v: number) => v },
  { id: 'breakeven10y', seriesId: 'T10YIE', transform: (v: number) => v / 100 },
];

// Yield Curve metric requires special handling (computed from two series)
const YIELD_CURVE_METRICS = [
  { id: 'yc_10y_2y', dgs10: 'DGS10', dgs2: 'DGS2' },
];

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

/**
 * Fetch historical data from FRED
 */
async function fetchFredHistory(
  seriesId: string,
  years: number = 10,
): Promise<FredObservation[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);

  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', config.fredApiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('observation_start', startDate.toISOString().split('T')[0]);
  url.searchParams.set('observation_end', endDate.toISOString().split('T')[0]);

  logger.info({ seriesId, startDate, endDate }, 'Fetching FRED historical data');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as FredResponse;

  // Filter out missing values (represented as '.')
  const validObservations = json.observations.filter((obs) => obs.value !== '.');

  logger.info(
    { seriesId, count: validObservations.length },
    'Fetched historical observations',
  );

  return validObservations;
}

/**
 * Insert historical values into database
 */
async function insertHistoricalValues(
  indicatorId: string,
  observations: FredObservation[],
  transform: (v: number) => number,
): Promise<void> {
  const values = observations.map((obs) => ({
    indicatorId,
    date: obs.date,
    rawValue: transform(Number(obs.value)),
  }));

  // Batch insert
  const query = `
    INSERT INTO history_values (indicator_id, date, raw_value, source)
    VALUES ($1, $2, $3, 'fred_backfill')
    ON CONFLICT (indicator_id, date)
    DO UPDATE SET raw_value = EXCLUDED.raw_value, source = EXCLUDED.source
  `;

  let inserted = 0;
  for (const val of values) {
    try {
      await pool.query(query, [val.indicatorId, val.date, val.rawValue]);
      inserted++;
    } catch (error) {
      logger.error({ indicatorId, date: val.date, error }, 'Failed to insert historical value');
    }
  }

  logger.info({ indicatorId, inserted }, 'Inserted historical values');
}

/**
 * Calculate rolling statistics for an indicator
 */
async function calculateRollingStats(
  indicatorId: string,
  windowDays: number = 2520, // ~10 years of trading days
): Promise<void> {
  logger.info({ indicatorId, windowDays }, 'Calculating rolling statistics');

  // Get all dates for this indicator
  const datesResult = await pool.query(
    `SELECT DISTINCT date FROM history_values
     WHERE indicator_id = $1
     ORDER BY date ASC`,
    [indicatorId],
  );

  const dates = datesResult.rows.map((r) => r.date);

  let calculated = 0;
  for (let i = 0; i < dates.length; i++) {
    const currentDate = dates[i];
    const windowStart = Math.max(0, i - windowDays + 1);
    const windowDates = dates.slice(windowStart, i + 1);

    if (windowDates.length < 30) {
      // Skip if we don't have enough data points
      continue;
    }

    // Fetch values in the window
    const valuesResult = await pool.query(
      `SELECT raw_value FROM history_values
       WHERE indicator_id = $1 AND date = ANY($2::DATE[])
       ORDER BY date ASC`,
      [indicatorId, windowDates],
    );

    const values = valuesResult.rows.map((r) => r.raw_value);

    // Calculate statistics
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
    const stddev = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Insert stats
    await pool.query(
      `INSERT INTO stats_values
       (indicator_id, date, window_days, mean_value, stddev_value, min_value, max_value, sample_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (indicator_id, date)
       DO UPDATE SET
         mean_value = EXCLUDED.mean_value,
         stddev_value = EXCLUDED.stddev_value,
         min_value = EXCLUDED.min_value,
         max_value = EXCLUDED.max_value,
         sample_count = EXCLUDED.sample_count`,
      [indicatorId, currentDate, windowDates.length, mean, stddev, min, max, n],
    );

    calculated++;
  }

  logger.info({ indicatorId, calculated }, 'Calculated rolling statistics');
}

/**
 * Backfill yield curve spread data
 */
async function backfillYieldCurveSpread(
  id: string,
  dgs10SeriesId: string,
  dgs2SeriesId: string,
  years: number = 10,
): Promise<void> {
  logger.info({ id, dgs10SeriesId, dgs2SeriesId }, 'Backfilling yield curve spread');

  // Fetch both series
  const [dgs10Obs, dgs2Obs] = await Promise.all([
    fetchFredHistory(dgs10SeriesId, years),
    fetchFredHistory(dgs2SeriesId, years),
  ]);

  // Create date-indexed maps for efficient lookup
  const dgs10Map = new Map(dgs10Obs.map(obs => [obs.date, Number(obs.value)]));
  const dgs2Map = new Map(dgs2Obs.map(obs => [obs.date, Number(obs.value)]));

  // Calculate spread for dates where both values exist
  const spreadValues: Array<{ date: string; spread: number }> = [];

  for (const [date, dgs10Value] of dgs10Map) {
    const dgs2Value = dgs2Map.get(date);
    if (dgs2Value !== undefined) {
      // Spread = 10y - 2y (already in percentage points, no conversion needed)
      const spread = dgs10Value - dgs2Value;
      spreadValues.push({ date, spread });
    }
  }

  logger.info({ id, count: spreadValues.length }, 'Calculated yield curve spreads');

  // Insert spread values into history_values
  const query = `
    INSERT INTO history_values (indicator_id, date, raw_value, source)
    VALUES ($1, $2, $3, 'fred_backfill')
    ON CONFLICT (indicator_id, date)
    DO UPDATE SET raw_value = EXCLUDED.raw_value, source = EXCLUDED.source
  `;

  let inserted = 0;
  for (const { date, spread } of spreadValues) {
    try {
      await pool.query(query, [id, date, spread]);
      inserted++;
    } catch (error) {
      logger.error({ id, date, error }, 'Failed to insert yield curve spread');
    }
  }

  logger.info({ id, inserted }, 'Inserted yield curve spread values');

  // Calculate rolling statistics
  await calculateRollingStats(id);
}

/**
 * Main backfill logic
 */
async function backfillHistoricalData(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting historical data backfill');

  try {
    for (const metric of FRED_METRICS) {
      logger.info({ metricId: metric.id, seriesId: metric.seriesId }, 'Processing metric');

      // Fetch historical data
      const observations = await fetchFredHistory(metric.seriesId, 10);

      // Insert into database
      await insertHistoricalValues(metric.id, observations, metric.transform);

      // Calculate rolling statistics
      await calculateRollingStats(metric.id);

      // Sleep briefly to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Process yield curve metrics (computed from multiple series)
    for (const metric of YIELD_CURVE_METRICS) {
      logger.info({ metricId: metric.id }, 'Processing yield curve metric');

      await backfillYieldCurveSpread(metric.id, metric.dgs10, metric.dgs2, 10);

      // Sleep briefly to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Refresh materialized view
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stats');

    const duration = Date.now() - startTime;
    const totalMetrics = FRED_METRICS.length + YIELD_CURVE_METRICS.length;
    logger.info({ duration, metricsProcessed: totalMetrics }, 'Backfill completed successfully');
  } catch (error) {
    logger.error({ error }, 'Backfill failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await backfillHistoricalData();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in backfill worker');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in backfill worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in backfill worker');
  process.exit(1);
});

// Run the worker
main();
