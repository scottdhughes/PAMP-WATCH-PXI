import { fetchLatestFredObservation } from './clients/fredClient.js';
import { fetchBtcDailyReturn, fetchBtcPricesForIndicators } from './clients/coinGeckoClient.js';
import { calculateRSI, calculateMACD, calculateSignalMultiplier } from './utils/technicalIndicators.js';
import { fetchLatestIndicators, insertDailyIndicators } from './db.js';
import type { MetricFetcher, MetricSample } from './shared/types.js';
import { logger } from './logger.js';

// Stale cache threshold (48 hours)
const STALE_CACHE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const percent = (value: number): number => value / 100; // convert bps -> pct

/**
 * Wraps a fetcher function with error handling and logging
 */
function withErrorHandling(
  id: string,
  fetcher: () => Promise<MetricSample>,
): () => Promise<MetricSample> {
  return async () => {
    try {
      const result = await fetcher();
      logger.debug({ metricId: id }, 'Successfully fetched metric');
      return result;
    } catch (error) {
      logger.error({ metricId: id, error }, 'Failed to fetch metric');
      throw new Error(`Fetch failed for ${id}: ${(error as Error).message}`);
    }
  };
}

export const metricFetchers: MetricFetcher[] = [
  {
    id: 'hyOas',
    label: 'HY OAS',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('BAMLH0A0HYM2');
      return {
        id: 'hyOas',
        label: 'HY OAS',
        value: percent(value),
        unit: 'percent',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'igOas',
    label: 'IG OAS',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('BAMLC0A4CBBB');
      return {
        id: 'igOas',
        label: 'IG OAS',
        value: percent(value),
        unit: 'percent',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'vix',
    label: 'VIX Index',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('VIXCLS');
      return {
        id: 'vix',
        label: 'VIX Index',
        value,
        unit: 'index',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'u3',
    label: 'U-3 Unemployment',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('UNRATE');
      return {
        id: 'u3',
        label: 'U-3 Unemployment',
        value: value / 100, // convert percentage points to decimal
        unit: 'ratio',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'usd',
    label: 'USD Index (DXY)',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('DTWEXBGS');
      return {
        id: 'usd',
        label: 'USD Index (DXY)',
        value,
        unit: 'index',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'nfci',
    label: 'Chicago Fed NFCI',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('NFCI');
      return {
        id: 'nfci',
        label: 'Chicago Fed NFCI',
        value,
        unit: 'index',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'yc_10y_2y',
    label: 'Yield Curve Slope (10y-2y)',
    fetch: async () => {
      // Fetch both 10-year and 2-year Treasury yields
      const [dgs10Data, dgs2Data] = await Promise.all([
        fetchLatestFredObservation('DGS10'),
        fetchLatestFredObservation('DGS2'),
      ]);

      // Calculate spread: 10y - 2y (in percentage points)
      const spread = dgs10Data.value - dgs2Data.value;

      // Use the most recent timestamp
      const timestamp = dgs10Data.timestamp > dgs2Data.timestamp ? dgs10Data.timestamp : dgs2Data.timestamp;

      return {
        id: 'yc_10y_2y',
        label: 'Yield Curve Slope (10y-2y)',
        value: spread,
        unit: 'percentage_points',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
        metadata: {
          dgs10: dgs10Data.value,
          dgs2: dgs2Data.value,
          isInverted: spread < 0,
        },
      };
    },
  },
  {
    id: 'btcReturn',
    label: 'BTC Daily Return',
    fetch: async () => {
      // Fetch daily return
      const { value, timestamp, metadata } = await fetchBtcDailyReturn();

      // Fetch cached technical indicators from database
      let rsi: number | null = null;
      let macd: { value: number; signal: number; histogram: number } | null = null;
      let signalMultiplier = 1.0;
      let indicatorSource = 'none';

      try {
        const cached = await fetchLatestIndicators();

        if (cached) {
          const cacheAge = Date.now() - new Date(cached.updatedAt).getTime();

          // Check if cache is stale (> 48 hours)
          if (cacheAge > STALE_CACHE_THRESHOLD_MS) {
            const ageHours = (cacheAge / (1000 * 60 * 60)).toFixed(1);
            logger.warn(
              { ageHours, threshold: 48 },
              'Cache is stale, auto-refreshing with live calculation',
            );

            // AUTO-REFRESH: Calculate indicators live
            const prices = await fetchBtcPricesForIndicators(35);
            rsi = calculateRSI(prices, 14);
            macd = calculateMACD(prices, 12, 26, 9);
            signalMultiplier = calculateSignalMultiplier(rsi, macd);
            indicatorSource = 'auto_refresh';

            // Update cache with freshly calculated values
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            try {
              await insertDailyIndicators({
                date: today,
                rsi,
                macd,
                signalMultiplier,
              });
              logger.info(
                { rsi, macd: macd?.value, signalMultiplier, source: indicatorSource },
                'BTC indicators calculated and cache refreshed automatically',
              );
            } catch (cacheUpdateError) {
              logger.error(
                { error: cacheUpdateError },
                'Failed to update cache after live calculation',
              );
              // Continue with live values even if cache update fails
            }
          } else {
            // Use cached values
            rsi = cached.rsi;
            macd = cached.macdValue !== null ? {
              value: cached.macdValue,
              signal: cached.macdSignal!,
              histogram: cached.macdHistogram!,
            } : null;
            signalMultiplier = cached.signalMultiplier;
            indicatorSource = 'daily_cache';

            const ageHours = (cacheAge / (1000 * 60 * 60)).toFixed(1);
            logger.debug(
              { rsi, signalMultiplier, ageHours },
              'Using cached BTC indicators',
            );
          }
        } else {
          // No cache exists - calculate live and create cache (first run)
          logger.warn('No cached indicators found, calculating live and creating cache (first run)');

          const prices = await fetchBtcPricesForIndicators(35);
          rsi = calculateRSI(prices, 14);
          macd = calculateMACD(prices, 12, 26, 9);
          signalMultiplier = calculateSignalMultiplier(rsi, macd);
          indicatorSource = 'live_first_run';

          // Create initial cache entry
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          try {
            await insertDailyIndicators({
              date: today,
              rsi,
              macd,
              signalMultiplier,
            });
            logger.info(
              { rsi, macd: macd?.value, signalMultiplier },
              'BTC indicators calculated and initial cache created',
            );
          } catch (cacheCreateError) {
            logger.error(
              { error: cacheCreateError },
              'Failed to create initial cache, continuing with live values',
            );
          }
        }
      } catch (error) {
        logger.error(
          { error: (error as Error).message },
          'Failed to fetch/calculate BTC indicators, using default multiplier',
        );
        indicatorSource = 'error_fallback';
      }

      return {
        id: 'btcReturn',
        label: 'BTC Daily Return',
        value,
        unit: 'ratio',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
        metadata: {
          ...metadata,
          rsi,
          macd: macd ? {
            value: macd.value,
            signal: macd.signal,
            histogram: macd.histogram,
          } : null,
          signalMultiplier,
          indicatorSource, // Track where indicators came from
        },
      };
    },
  },
  {
    id: 'stlfsi',
    label: 'St. Louis Fed Financial Stress Index',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('STLFSI2');
      return {
        id: 'stlfsi',
        label: 'St. Louis Fed Financial Stress Index',
        value,
        unit: 'index',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
  {
    id: 'breakeven10y',
    label: '10-Year Breakeven Inflation',
    fetch: async () => {
      const { value, timestamp } = await fetchLatestFredObservation('T10YIE');
      return {
        id: 'breakeven10y',
        label: '10-Year Breakeven Inflation',
        value: value / 100, // Convert percentage points to decimal
        unit: 'percent',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
      };
    },
  },
];
