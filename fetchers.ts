import { fetchLatestFredObservation } from './clients/fredClient.js';
import { fetchBtcDailyReturn } from './clients/coinGeckoClient.js';
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
      const { value, timestamp, metadata } = await fetchBtcDailyReturn();
      return {
        id: 'btcReturn',
        label: 'BTC Daily Return',
        value,
        unit: 'ratio',
        sourceTimestamp: timestamp,
        ingestedAt: new Date().toISOString(),
        metadata,
      };
    },
  },
];
