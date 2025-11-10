import { config } from '../config.js';

/**
 * Response type from AlphaVantage API
 */
interface GlobalQuoteResponse {
  'Global Quote': {
    '05. price': string;
    '07. latest trading day': string;
  };
}

/**
 * Fetches global quote data from AlphaVantage with retry logic
 *
 * @param symbol - Stock/index symbol
 * @param retries - Number of retry attempts (default: 3)
 * @returns Value and timestamp of the latest quote
 * @throws Error if the request fails after all retries
 */
export const fetchGlobalQuote = async (
  symbol: string,
  retries = 3,
): Promise<{ value: number; timestamp: string }> => {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'GLOBAL_QUOTE');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', config.alphaVantageKey);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`AlphaVantage request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as GlobalQuoteResponse;
      const quote = json['Global Quote'];
      if (!quote || !quote['05. price']) {
        throw new Error(`No quote found for symbol ${symbol}`);
      }
      return {
        value: Number(quote['05. price']),
        timestamp: new Date(`${quote['07. latest trading day']}T16:00:00Z`).toISOString(),
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

  throw new Error(`AlphaVantage fetch failed after ${retries + 1} attempts: ${lastError?.message}`);
};
