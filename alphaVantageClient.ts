import { config } from '../config.js';

interface GlobalQuoteResponse {
  'Global Quote': {
    '05. price': string;
    '07. latest trading day': string;
  };
}

export const fetchGlobalQuote = async (
  symbol: string,
): Promise<{ value: number; timestamp: string }> => {
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'GLOBAL_QUOTE');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', config.alphaVantageKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`AlphaVantage request failed: ${response.status}`);
  }
  const json = (await response.json()) as GlobalQuoteResponse;
  const quote = json['Global Quote'];
  if (!quote) {
    throw new Error(`No quote found for symbol ${symbol}`);
  }
  return {
    value: Number(quote['05. price']),
    timestamp: new Date(`${quote['07. latest trading day']}T16:00:00Z`).toISOString(),
  };
};
