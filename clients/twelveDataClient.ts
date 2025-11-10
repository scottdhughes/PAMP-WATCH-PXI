import { config } from '../config.js';

/**
 * Response type from TwelveData API
 */
interface TwelveDataResponse {
  values: Array<{
    datetime: string;
    close: string;
  }>;
  status?: string;
  message?: string;
}

/**
 * Fetches latest value from TwelveData with retry logic
 *
 * @param symbol - Symbol to fetch
 * @param interval - Time interval (default: '1min')
 * @param retries - Number of retry attempts (default: 3)
 * @returns Value and timestamp of the latest data point
 * @throws Error if the request fails after all retries
 */
export const fetchLatestTwelveDataValue = async (
  symbol: string,
  interval = '1min',
  retries = 3,
): Promise<{ value: number; timestamp: string }> => {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('apikey', config.twelveDataKey);
  url.searchParams.set('outputsize', '1');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      const json = (await response.json()) as TwelveDataResponse;
      if ((json.status && json.status !== 'ok') || !json.values?.length) {
        throw new Error(`TwelveData error for ${symbol}: ${json.message ?? 'unknown'}`);
      }
      const latest = json.values[0];
      return { value: Number(latest.close), timestamp: new Date(`${latest.datetime}Z`).toISOString() };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`TwelveData fetch failed after ${retries + 1} attempts: ${lastError?.message}`);
};
