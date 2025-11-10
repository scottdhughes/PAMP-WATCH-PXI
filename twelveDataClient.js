import { config } from '../config.js';
export const fetchLatestTwelveDataValue = async (symbol, interval = '1min') => {
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('apikey', config.twelveDataKey);
    url.searchParams.set('outputsize', '1');
    const response = await fetch(url);
    const json = (await response.json());
    if ((json.status && json.status !== 'ok') || !json.values?.length) {
        throw new Error(`TwelveData error for ${symbol}: ${json.message ?? 'unknown'}`);
    }
    const latest = json.values[0];
    return { value: Number(latest.close), timestamp: new Date(`${latest.datetime}Z`).toISOString() };
};
