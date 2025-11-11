#!/usr/bin/env node
/**
 * Daily Technical Indicators Worker
 *
 * Runs twice per day (00:05 UTC, 12:05 UTC) to calculate and cache BTC technical indicators.
 * This reduces API calls from 1,440/day to 2/day while maintaining accuracy.
 *
 * Features:
 * - Calculates RSI (14-day) and MACD (12,26,9) from 35-day BTC price history
 * - Caches results in btc_daily_indicators table
 * - Generates alerts if cache becomes stale (>36 hours)
 * - Monitors calculation failures and retries
 *
 * Schedule: 00:05 UTC and 12:05 UTC daily (twice-daily refresh)
 */

import { fetchBtcPricesForIndicators } from '../clients/coinGeckoClient.js';
import {
  calculateRSI,
  calculateMACD,
  calculateSignalMultiplier,
} from '../utils/technicalIndicators.js';
import { insertDailyIndicators, fetchLatestIndicators, insertAlerts, closePool } from '../db.js';
import { logger } from '../logger.js';

// Alert threshold for stale cache (36 hours)
const STALE_CACHE_THRESHOLD_HOURS = 36;

/**
 * Check if cache is stale and generate alert if needed
 */
async function checkCacheStaleAlert(): Promise<void> {
  try {
    const latest = await fetchLatestIndicators();

    if (!latest) {
      logger.warn('No cached indicators found - this is the first run');
      return;
    }

    const cacheDate = new Date(latest.date);
    const hoursSinceUpdate = (Date.now() - cacheDate.getTime()) / (1000 * 60 * 60);

    if (hoursSinceUpdate > STALE_CACHE_THRESHOLD_HOURS) {
      logger.error(
        { hoursSinceUpdate: hoursSinceUpdate.toFixed(1) },
        'BTC indicator cache is STALE - generating alert',
      );

      // Insert alert into database
      await insertAlerts([
        {
          alertType: 'stale_indicator_cache',
          indicatorId: 'btcReturn',
          timestamp: new Date().toISOString(),
          rawValue: null,
          zScore: null,
          weight: null,
          contribution: null,
          threshold: STALE_CACHE_THRESHOLD_HOURS,
          message: `BTC indicator cache is ${hoursSinceUpdate.toFixed(1)} hours old (threshold: ${STALE_CACHE_THRESHOLD_HOURS}h). Daily worker may have failed.`,
          severity: 'critical',
        },
      ]);
    } else {
      logger.info(
        { hoursSinceUpdate: hoursSinceUpdate.toFixed(1) },
        'Cache freshness check passed',
      );
    }
  } catch (error) {
    logger.error({ error }, 'Failed to check cache staleness');
  }
}

/**
 * Main calculation logic
 */
async function calculateDailyIndicators(): Promise<void> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const dateOnly = timestamp.split('T')[0]; // YYYY-MM-DD

  logger.info('Starting daily BTC technical indicators calculation');

  try {
    // Check for stale cache BEFORE calculating new indicators
    await checkCacheStaleAlert();

    // Fetch 35 days of BTC prices for indicators
    logger.info('Fetching 35 days of BTC historical prices for indicators');
    const prices = await fetchBtcPricesForIndicators(35);

    if (prices.length < 35) {
      throw new Error(
        `Insufficient BTC price data: got ${prices.length}, need 35`,
      );
    }

    // Calculate RSI (14-day)
    const rsi = calculateRSI(prices, 14);
    if (rsi === null) {
      logger.warn('RSI calculation returned null, using default values');
    }

    // Calculate MACD (12, 26, 9)
    const macd = calculateMACD(prices, 12, 26, 9);
    if (macd === null) {
      logger.warn('MACD calculation returned null, using default values');
    }

    // Calculate signal multiplier
    const signalMultiplier = calculateSignalMultiplier(rsi, macd);

    // Store in database with UPSERT (handles twice-daily updates)
    await insertDailyIndicators({
      date: dateOnly,
      rsi,
      macd: macd
        ? {
            value: macd.MACD,
            signal: macd.signal,
            histogram: macd.histogram,
          }
        : null,
      signalMultiplier,
    });

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        date: dateOnly,
        rsi: rsi !== null ? rsi.toFixed(2) : 'null',
        macd: macd !== null ? macd.MACD.toFixed(2) : 'null',
        signalMultiplier: signalMultiplier.toFixed(3),
      },
      'Daily indicators calculated and cached successfully',
    );

    // Generate info alert about successful update
    await insertAlerts([
      {
        alertType: 'indicator_cache_updated',
        indicatorId: 'btcReturn',
        timestamp,
        rawValue: signalMultiplier,
        zScore: rsi,
        weight: null,
        contribution: null,
        threshold: null,
        message: `BTC indicators refreshed: RSI=${rsi !== null ? rsi.toFixed(1) : 'N/A'}, MACD=${macd !== null ? macd.MACD.toFixed(0) : 'N/A'}, Multiplier=${signalMultiplier.toFixed(2)}`,
        severity: 'info',
      },
    ]);
  } catch (error) {
    logger.error({ error }, 'Daily indicator calculation failed');

    // Generate critical alert for calculation failure
    await insertAlerts([
      {
        alertType: 'indicator_calculation_failed',
        indicatorId: 'btcReturn',
        timestamp,
        rawValue: null,
        zScore: null,
        weight: null,
        contribution: null,
        threshold: null,
        message: `BTC indicator calculation failed: ${(error as Error).message}. Ingest worker will fall back to live calculation.`,
        severity: 'critical',
      },
    ]);

    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await calculateDailyIndicators();
    await closePool();
    logger.info('Daily indicator worker completed successfully');
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in daily indicator worker');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in daily indicator worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in daily indicator worker');
  process.exit(1);
});

// Run the worker
main();
