#!/usr/bin/env node
/**
 * BTC Historical Data Backfill Worker
 *
 * Fetches historical BTC price data from CoinGecko and calculates daily returns.
 * Stores data in history_values and computes rolling statistics.
 *
 * Note: CoinGecko free API provides up to 365 days of daily data.
 * For longer history, multiple requests with different time ranges are needed.
 */

import { fetchBtcHistoricalPrices, calculateDailyReturns } from '../clients/coinGeckoClient.js';
import { pool, closePool } from '../db.js';
import { logger } from '../logger.js';

const INDICATOR_ID = 'btcReturn';

/**
 * Insert historical BTC daily returns into database
 */
async function insertBtcHistoricalReturns(
  returns: Array<{ date: string; dailyReturn: number }>,
): Promise<void> {
  logger.info({ count: returns.length }, 'Inserting BTC historical returns');

  const query = `
    INSERT INTO history_values (indicator_id, date, raw_value, source)
    VALUES ($1, $2, $3, 'coingecko_backfill')
    ON CONFLICT (indicator_id, date)
    DO UPDATE SET raw_value = EXCLUDED.raw_value, source = EXCLUDED.source
  `;

  let inserted = 0;
  let updated = 0;

  for (const ret of returns) {
    try {
      const result = await pool.query(query, [INDICATOR_ID, ret.date, ret.dailyReturn]);
      if (result.rowCount && result.rowCount > 0) {
        inserted++;
      } else {
        updated++;
      }
    } catch (error) {
      logger.error(
        { date: ret.date, error },
        'Failed to insert BTC historical return'
      );
    }
  }

  logger.info({ inserted, updated }, 'BTC historical returns inserted');
}

/**
 * Calculate rolling statistics for BTC returns
 */
async function calculateBtcRollingStats(
  windowDays: number = 2520, // ~10 years of trading days
): Promise<void> {
  logger.info({ indicatorId: INDICATOR_ID, windowDays }, 'Calculating BTC rolling statistics');

  // Get all dates for BTC
  const datesResult = await pool.query(
    `SELECT DISTINCT date FROM history_values
     WHERE indicator_id = $1
     ORDER BY date ASC`,
    [INDICATOR_ID],
  );

  const dates = datesResult.rows.map((r) => r.date);
  logger.info({ totalDates: dates.length }, 'Found BTC historical dates');

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
      [INDICATOR_ID, windowDates],
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
      [INDICATOR_ID, currentDate, windowDates.length, mean, stddev, min, max, n],
    );

    calculated++;

    // Progress logging
    if (calculated % 100 === 0) {
      logger.info({ progress: `${calculated}/${dates.length}` }, 'Statistics calculation progress');
    }
  }

  logger.info({ indicatorId: INDICATOR_ID, calculated }, 'BTC rolling statistics calculated');
}

/**
 * Main backfill logic for BTC
 */
async function backfillBtcData(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting BTC historical data backfill');

  try {
    // Fetch last 365 days from CoinGecko (free tier limit)
    // For more history, would need to make multiple requests or use paid tier
    const days = 365;

    logger.info({ days }, 'Fetching BTC historical prices');
    const prices = await fetchBtcHistoricalPrices(days);

    logger.info({ priceCount: prices.length }, 'Calculating daily returns');
    const returns = calculateDailyReturns(prices);

    logger.info({ returnCount: returns.length }, 'Inserting historical returns');
    await insertBtcHistoricalReturns(returns);

    logger.info('Calculating rolling statistics');
    await calculateBtcRollingStats();

    // Refresh materialized view to include BTC stats
    logger.info('Refreshing materialized view');
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stats');

    const duration = Date.now() - startTime;
    logger.info(
      { duration, daysBackfilled: days },
      'BTC backfill completed successfully'
    );

    // Show summary
    const statsCount = await pool.query(
      'SELECT COUNT(*) as count FROM stats_values WHERE indicator_id = $1',
      [INDICATOR_ID]
    );
    logger.info(
      { statsRecords: statsCount.rows[0].count },
      'BTC statistics available'
    );

  } catch (error) {
    logger.error({ error }, 'BTC backfill failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await backfillBtcData();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in BTC backfill worker');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in BTC backfill worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in BTC backfill worker');
  process.exit(1);
});

// Run the worker
main();
