import { config } from '../config.js';
export const fetchBtcDailyReturn = async () => {
    const url = new URL(`${config.coinGeckoBase}/coins/bitcoin/market_chart`);
    url.searchParams.set('vs_currency', 'usd');
    url.searchParams.set('days', '2');
    url.searchParams.set('interval', 'daily');
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`CoinGecko request failed: ${response.status}`);
    }
    const json = (await response.json());
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
};
