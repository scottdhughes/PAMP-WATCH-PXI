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
 * Primary: CoinGecko (provides 4-day price history for 3-day MA smoothing)
 * Fallback: Coinbase spot price (requires previous price from cache/DB)
 *
 * Enhancement: Applies 3-day moving average to smooth out crypto volatility noise
 *
 * @param retries - Number of retry attempts for CoinGecko (default: 3)
 * @param previousPrice - Optional previous BTC price for Coinbase fallback
 * @returns Smoothed daily return value (3-day MA), timestamp, and metadata
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
  // Try CoinGecko first (preferred - provides 4-day history for 3-day MA)
  const url = new URL(`${config.coinGeckoBase}/coins/bitcoin/market_chart`);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('days', '4'); // Fetch 4 days to get 3 daily returns
  url.searchParams.set('interval', 'daily');

  let coinGeckoError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CoinGecko request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as MarketChartResponse;
      if (json.prices.length < 4) {
        throw new Error('Not enough BTC datapoints from CoinGecko (need 4 days for 3-day MA)');
      }

      // Calculate daily returns for the last 3 days
      const returns: number[] = [];
      const prices: Array<{ ts: number; price: number }> = [];

      for (let i = json.prices.length - 3; i < json.prices.length; i++) {
        const [prevTs, prevPrice] = json.prices[i - 1];
        const [currTs, currPrice] = json.prices[i];
        const dailyReturn = (currPrice - prevPrice) / prevPrice;
        returns.push(dailyReturn);
        prices.push({ ts: currTs, price: currPrice });
      }

      // Calculate 3-day moving average
      const smoothedReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

      // Raw return is the most recent day's return (unsmoothed)
      const rawReturn = returns[returns.length - 1];

      // Use the most recent timestamp
      const [currTs, currPrice] = json.prices[json.prices.length - 1];
      const [prevTs, prevPrice] = json.prices[json.prices.length - 2];

      logger.debug(
        {
          source: 'CoinGecko',
          rawReturn: rawReturn.toFixed(6),
          smoothedReturn: smoothedReturn.toFixed(6),
          ma_days: 3,
        },
        'BTC daily return calculated with 3-day MA smoothing'
      );

      return {
        value: smoothedReturn, // Return smoothed value
        timestamp: new Date(currTs).toISOString(),
        metadata: {
          source: 'CoinGecko',
          prevPrice,
          currPrice,
          prevTs,
          currTs,
          rawReturn, // Preserve unsmoothed value for analysis
          smoothedReturn,
          smoothingWindow: 3,
          returns_3day: returns, // Store all 3 returns for transparency
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

/**
 * Fetches BTC closing prices for technical indicator calculation
 *
 * This function fetches enough historical data to calculate RSI (14-day) and MACD (26-day)
 *
 * @param days - Number of days to fetch (default: 35 - enough for MACD)
 * @returns Array of closing prices (most recent last)
 * @throws Error if the request fails
 */
export const fetchBtcPricesForIndicators = async (
  days: number = 35,
): Promise<number[]> => {
  try {
    const priceData = await fetchBtcHistoricalPrices(days);
    // Return just the prices in chronological order (oldest first, newest last)
    return priceData.map((p) => p.price);
  } catch (error) {
    logger.error({ error, days }, 'Failed to fetch BTC prices for technical indicators');
    throw error;
  }
};
