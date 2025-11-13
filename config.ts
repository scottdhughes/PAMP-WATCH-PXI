import 'dotenv/config';

/**
 * Validates and returns required environment variable
 *
 * @param name - Environment variable name
 * @param fallback - Optional fallback value
 * @param validator - Optional validation function
 * @returns Validated environment variable value
 * @throws Error if variable is missing or invalid
 */
const required = (
  name: string,
  fallback?: string,
  validator?: (value: string) => boolean,
): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  if (validator && !validator(value)) {
    throw new Error(`Invalid value for env var ${name}`);
  }
  return value;
};

/**
 * Validates API key format (minimum length)
 */
const validateApiKey = (key: string): boolean => key.length >= 8;

/**
 * Validates database URL format
 */
const validateDatabaseUrl = (url: string): boolean => {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
};

/**
 * Validates CORS origins
 */
const parseCorsOrigins = (origins?: string): string[] | boolean => {
  if (!origins || origins === '*') return true;
  return origins.split(',').map((o) => o.trim());
};

/**
 * Application configuration
 */
export const config = {
  // API Keys
  fredApiKey: required('FRED_API_KEY', undefined, validateApiKey),
  alphaVantageKey: required('ALPHA_VANTAGE_API_KEY', undefined, validateApiKey),
  twelveDataKey: required('TWELVEDATA_API_KEY', undefined, validateApiKey),

  // Database
  postgresUrl: required('DATABASE_URL', undefined, validateDatabaseUrl),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  dbPoolMin: Number(process.env.DB_POOL_MIN ?? 2),

  // External APIs
  coinGeckoBase: process.env.COINGECKO_BASE ?? 'https://api.coingecko.com/api/v3',

  // Scheduling
  cronExpression: process.env.INGEST_CRON ?? '* * * * *',
  staleThresholdMs: Number(process.env.STALE_THRESHOLD_MS ?? 5 * 60 * 1000),

  // Server
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),

  // Monitoring
  logLevel: process.env.LOG_LEVEL ?? 'info',

  // Caching
  cacheEnabled: process.env.CACHE_ENABLED !== 'false',
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 10),

  // Rate Limiting
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 100),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',

  // PXI Computation
  maxMetricContribution: Number(process.env.MAX_METRIC_CONTRIBUTION ?? 0.25), // Default 25% cap
};
