/**
 * Coinbase API Client
 *
 * Provides fallback BTC price data when CoinGecko is unavailable.
 * Uses Coinbase's public API (no auth required for basic price data).
 */

/**
 * Response type from Coinbase API
 */
interface CoinbaseSpotPriceResponse {
  data: {
    base: string;      // "BTC"
    currency: string;  // "USD"
    amount: string;    // "65432.10"
  };
}

/**
 * Fetches current BTC spot price from Coinbase
 *
 * @param retries - Number of retry attempts (default: 2)
 * @returns Current BTC price in USD
 * @throws Error if the request fails after all retries
 */
export const fetchBtcSpotPrice = async (
  retries = 2,
): Promise<{
  price: number;
  timestamp: string;
}> => {
  const url = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Coinbase request failed: ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as CoinbaseSpotPriceResponse;
      const price = parseFloat(json.data.amount);

      if (isNaN(price) || price <= 0) {
        throw new Error('Invalid price data from Coinbase');
      }

      return {
        price,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        // Exponential backoff: 1s, 2s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Coinbase fetch failed after ${retries + 1} attempts: ${lastError?.message}`);
};

/**
 * Fetches historical BTC prices from Coinbase
 *
 * Note: Coinbase's public API has limited historical data.
 * For extensive historical data, use CoinGecko's free API.
 *
 * @param date - Date to fetch price for
 * @returns BTC price for the given date
 */
export const fetchHistoricalBtcPrice = async (
  date: string, // YYYY-MM-DD format
): Promise<{
  price: number;
  date: string;
}> => {
  // Coinbase public API doesn't support historical prices without auth
  // This function is a placeholder for potential future enhancement
  // or if you have a Coinbase API key
  throw new Error('Historical price fetching via Coinbase requires authentication');
};

/**
 * Calculates daily return using current and previous prices
 *
 * @param currentPrice - Current BTC price
 * @param previousPrice - Previous BTC price
 * @returns Daily return as a ratio
 */
export const calculateDailyReturn = (
  currentPrice: number,
  previousPrice: number,
): number => {
  if (previousPrice <= 0) {
    throw new Error('Previous price must be positive');
  }
  return (currentPrice - previousPrice) / previousPrice;
};
