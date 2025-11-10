import 'dotenv/config';

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
};

export const config = {
  fredApiKey: required('FRED_API_KEY'),
  alphaVantageKey: required('ALPHA_VANTAGE_API_KEY'),
  twelveDataKey: required('TWELVEDATA_API_KEY'),
  postgresUrl: required('DATABASE_URL'),
  coinGeckoBase: process.env.COINGECKO_BASE ?? 'https://api.coingecko.com/api/v3',
  cronExpression: process.env.INGEST_CRON ?? '* * * * *', // every minute
  staleThresholdMs: Number(process.env.STALE_THRESHOLD_MS ?? 5 * 60 * 1000),
};
