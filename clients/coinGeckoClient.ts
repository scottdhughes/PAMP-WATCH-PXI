import { config } from '../config.js';

/**
 * Response type from CoinGecko API
 */
interface MarketChartResponse {
  prices: Array<[number, number]>; // [timestamp, price]
}

/**
 * Fetches Bitcoin daily return from CoinGecko with retry logic
 *
 * @param retries - Number of retry attempts (default: 3)
 * @returns Daily return value, timestamp, and metadata
 * @throws Error if the request fails after all retries
 */
export const fetchBtcDailyReturn = async (
  retries = 3,
): Promise<{
  value: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}> => {
  const url = new URL(`${config.coinGeckoBase}/coins/bitcoin/market_chart`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('days', '2');
  url.searchParams.set('interval', 'daily');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as MarketChartResponse;
      if (json.prices.length < 2) {
        throw new Error('Not enough BTC datapoints');
      }
      const [prevTs, prevPrice] = json.prices[json.prices.length - 2];
      const [currTs, currPrice] = json.prices[json.prices.length - 1];
      const dailyReturn = (currPrice - prevPrice) / prevPrice;
      return {
        value: dailyReturn,
        timestamp: new Date(currTs).toISOString(),
        metadata: { prevPrice, currPrice, prevTs, currTs },
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`CoinGecko fetch failed after ${retries + 1} attempts: ${lastError?.message}`);
};
