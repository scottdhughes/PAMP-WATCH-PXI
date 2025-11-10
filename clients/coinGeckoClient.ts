import { config } from '../config.js';
import { fetchBtcSpotPrice } from './coinbaseClient.js';
import { logger } from '../logger.js';

/**
 * Response type from CoinGecko API
 */
interface MarketChartResponse {
  prices: Array<[number, number]>; // [timestamp, price]
}

/**
 * Fetches Bitcoin daily return from CoinGecko with Coinbase fallback
 *
 * Primary: CoinGecko (provides 2-day price history for calculating return)
 * Fallback: Coinbase spot price (requires previous price from cache/DB)
 *
 * @param retries - Number of retry attempts for CoinGecko (default: 3)
 * @param previousPrice - Optional previous BTC price for Coinbase fallback
 * @returns Daily return value, timestamp, and metadata
 * @throws Error if both CoinGecko and Coinbase fallback fail
 */
export const fetchBtcDailyReturn = async (
  retries = 3,
  previousPrice?: number,
): Promise<{
  value: number;
  timestamp: string;
  metadata: Record<string, unknown>;
}> => {
  // Try CoinGecko first (preferred - provides 2-day history)
  const url = new URL(`${config.coinGeckoBase}/coins/bitcoin/market_chart`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('days', '2');
  url.searchParams.set('interval', 'daily');

  let coinGeckoError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as MarketChartResponse;
      if (json.prices.length < 2) {
        throw new Error('Not enough BTC datapoints from CoinGecko');
      }
      const [prevTs, prevPrice] = json.prices[json.prices.length - 2];
      const [currTs, currPrice] = json.prices[json.prices.length - 1];
      const dailyReturn = (currPrice - prevPrice) / prevPrice;

      logger.debug({ source: 'CoinGecko', prevPrice, currPrice }, 'BTC daily return calculated');

      return {
        value: dailyReturn,
        timestamp: new Date(currTs).toISOString(),
        metadata: {
          source: 'CoinGecko',
          prevPrice,
          currPrice,
          prevTs,
          currTs,
        },
      };
    } catch (error) {
      coinGeckoError = error as Error;
      if (attempt < retries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // CoinGecko failed - try Coinbase fallback
  logger.warn(
    { error: coinGeckoError?.message },
    'CoinGecko failed, attempting Coinbase fallback'
  );

  if (!previousPrice || previousPrice <= 0) {
    throw new Error(
      `CoinGecko failed and no valid previous price available for Coinbase fallback: ${coinGeckoError?.message}`
    );
  }

  try {
    const { price: currentPrice, timestamp } = await fetchBtcSpotPrice();
    const dailyReturn = (currentPrice - previousPrice) / previousPrice;

    logger.info(
      { source: 'Coinbase', previousPrice, currentPrice },
      'BTC daily return calculated using Coinbase fallback'
    );

    return {
      value: dailyReturn,
      timestamp,
      metadata: {
        source: 'Coinbase (fallback)',
        prevPrice: previousPrice,
        currPrice: currentPrice,
        note: 'Previous price from cache/database',
      },
    };
  } catch (coinbaseError) {
    throw new Error(
      `Both CoinGecko and Coinbase failed. ` +
      `CoinGecko: ${coinGeckoError?.message}. ` +
      `Coinbase: ${(coinbaseError as Error).message}`
    );
  }
};

/**
 * Fetches historical BTC prices from CoinGecko for backfilling
 *
 * @param days - Number of days of history to fetch (max: 365 for free tier)
 * @returns Array of date/price pairs
 * @throws Error if the request fails
 */
export const fetchBtcHistoricalPrices = async (
  days: number = 365,
): Promise<Array<{ date: string; price: number }>> => {
  const url = new URL(`${config.coinGeckoBase}/coins/bitcoin/market_chart`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('days', days.toString());
  url.searchParams.set('interval', 'daily');

  logger.info({ days }, 'Fetching BTC historical prices from CoinGecko');

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as MarketChartResponse;

    if (json.prices.length === 0) {
      throw new Error('No historical BTC price data returned from CoinGecko');
    }

    // Convert timestamps to dates and calculate daily returns
    const priceData: Array<{ date: string; price: number }> = [];

    for (let i = 0; i < json.prices.length; i++) {
      const [timestamp, price] = json.prices[i];
      const date = new Date(timestamp).toISOString().split('T')[0]; // YYYY-MM-DD
      priceData.push({ date, price });
    }

    logger.info({ count: priceData.length }, 'Fetched BTC historical prices');

    return priceData;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch BTC historical prices');
    throw error;
  }
};

/**
 * Calculate daily returns from price series
 *
 * @param prices - Array of date/price objects
 * @returns Array of date/dailyReturn objects
 */
export const calculateDailyReturns = (
  prices: Array<{ date: string; price: number }>,
): Array<{ date: string; dailyReturn: number }> => {
  const returns: Array<{ date: string; dailyReturn: number }> = [];

  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1].price;
    const currPrice = prices[i].price;
    const dailyReturn = (currPrice - prevPrice) / prevPrice;

    returns.push({
      date: prices[i].date,
      dailyReturn,
    });
  }

  return returns;
};
