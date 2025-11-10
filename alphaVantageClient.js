import { config } from '../config.js';
export const fetchGlobalQuote = async (symbol) => {
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'GLOBAL_QUOTE');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', config.alphaVantageKey);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`AlphaVantage request failed: ${response.status}`);
    }
    const json = (await response.json());
    const quote = json['Global Quote'];
    if (!quote) {
        throw new Error(`No quote found for symbol ${symbol}`);
    }
    return {
        value: Number(quote['05. price']),
        timestamp: new Date(`${quote['07. latest trading day']}T16:00:00Z`).toISOString(),
    };
};
