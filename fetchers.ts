import { fetchLatestFredObservation } from './clients/fredClient.js';
import { fetchBtcDailyReturn, fetchBtcPricesForIndicators } from './clients/coinGeckoClient.js';
import { calculateRSI, calculateMACD, calculateSignalMultiplier } from './utils/technicalIndicators.js';
import type { MetricFetcher, MetricSample } from './shared/types.js';
import { logger } from './logger.js';

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
    id: 'btcReturn',
    label: 'BTC Daily Return',
    fetch: async () => {
      // Fetch daily return
      const { value, timestamp, metadata } = await fetchBtcDailyReturn();

      // Attempt to calculate technical indicators (RSI, MACD)
      let rsi: number | null = null;
      let macd: { MACD: number; signal: number; histogram: number } | null = null;
      let signalMultiplier = 1.0;

      try {
        // Fetch 35 days of BTC prices for technical indicators
        const prices = await fetchBtcPricesForIndicators(35);

        // Calculate RSI (14-day)
        rsi = calculateRSI(prices, 14);

        // Calculate MACD (12, 26, 9)
        macd = calculateMACD(prices, 12, 26, 9);

        // Calculate signal multiplier based on RSI and MACD
        signalMultiplier = calculateSignalMultiplier(rsi, macd);

        logger.info(
          { rsi, macd: macd?.MACD, signalMultiplier },
          'BTC technical indicators calculated',
        );
      } catch (error) {
        logger.warn(
          { error: (error as Error).message },
          'Failed to calculate BTC technical indicators, using default multiplier',
        );
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
            value: macd.MACD,
            signal: macd.signal,
            histogram: macd.histogram,
          } : null,
          signalMultiplier,
        },
      };
    },
  },
];
