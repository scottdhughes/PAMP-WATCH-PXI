import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { buildLatestResponse } from './buildLatestResponse.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { pool, testConnection, getPXIHistory, fetchLatestIndicators } from './db.js';
import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateVolatility,
  calculateCumulativeReturn,
  calculateSortinoRatio,
} from './utils/analytics.js';
import { runBacktest, type BacktestConfig } from './lib/backtest-engine.js';

/**
 * Simple in-memory cache
 */
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Get data from cache
 */
function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Set data in cache
 */
function setInCache<T>(key: string, data: T, ttlSeconds: number): void {
  cache.set(key, {
    data,
    expiry: Date.now() + ttlSeconds * 1000,
  });
}

const server = Fastify({
  logger,
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  trustProxy: true,
});

/**
 * Register Fastify plugins
 */
const registerPlugins = async (): Promise<void> => {
  // CORS configuration - restrict to specific origins
  await server.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'OPTIONS'],
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    cache: 10000,
    allowList: ['127.0.0.1', 'localhost'],
    redis: undefined, // Use in-memory cache for now
  });
};

/**
 * Health check endpoint with database connectivity test
 */
server.get('/healthz', async (request, reply) => {
  try {
    await testConnection();
    return reply.code(200).send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    logger.error({ error }, 'Health check failed');
    return reply.code(503).send({
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

/**
 * V1 API: Get latest PXI data with caching
 */
server.get('/v1/pxi/latest', async (request, reply) => {
  try {
    // Check cache first
    if (config.cacheEnabled) {
      const cached = getFromCache<Awaited<ReturnType<typeof buildLatestResponse>>>('pxi:latest');
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    const data = await buildLatestResponse();
    if (!data) {
      return reply.code(503).send({ message: 'PXI composite not ready' });
    }

    // Cache the response
    if (config.cacheEnabled) {
      setInCache('pxi:latest', data, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return data;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch latest PXI');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch PXI data',
    });
  }
});

/**
 * Legacy endpoint (redirects to v1)
 */
server.get('/pxi/latest', async (request, reply) => {
  return reply.redirect(301, '/v1/pxi/latest');
});

/**
 * V1 API: Get latest PXI metrics only (for dashboard grid)
 * Returns just the underlying metrics array with z-scores and contributions
 */
server.get('/v1/pxi/metrics/latest', async (request, reply) => {
  try {
    // Check cache first
    if (config.cacheEnabled) {
      const cached = getFromCache<any[]>('pxi:metrics:latest');
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return { metrics: cached };
      }
    }

    const data = await buildLatestResponse();
    if (!data || !data.metrics) {
      return reply.code(503).send({ message: 'PXI metrics not ready' });
    }

    // Transform metrics to include all necessary fields
    const metrics = data.metrics.map(metric => ({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      delta: metric.delta || 0,
      delta7D: metric.delta7D,
      delta30D: metric.delta30D,
      lower: metric.lower,
      upper: metric.upper,
      zScore: metric.zScore,
      contribution: metric.contribution,
      status: metric.breach || 'Unknown',
      unit: metric.unit || 'value',
      health: metric.health,
      volatility: metric.volatility,
      stability: metric.stability,
    }));

    // Cache the metrics
    if (config.cacheEnabled) {
      setInCache('pxi:metrics:latest', metrics, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return { metrics };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch PXI metrics');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch PXI metrics',
    });
  }
});

/**
 * V1 API: Get complete dashboard snapshot (for real-time polling)
 * Returns all dashboard data in one call with version for change detection
 */
server.get('/v1/snapshot', async (request, reply) => {
  try {
    // Check cache first
    if (config.cacheEnabled) {
      const cached = getFromCache<any>('pxi:snapshot');
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    const data = await buildLatestResponse();
    if (!data) {
      return reply.code(503).send({ message: 'PXI data not ready' });
    }

    // Return complete snapshot with version
    const snapshot = {
      version: data.version,
      pxi: data.pxi,
      statusLabel: data.statusLabel,
      zScore: data.zScore,
      calculatedAt: data.calculatedAt,
      metrics: data.metrics,
      ticker: data.ticker,
      alerts: data.alerts,
      regime: data.regime,
    };

    // Cache the snapshot
    if (config.cacheEnabled) {
      setInCache('pxi:snapshot', snapshot, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return snapshot;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch dashboard snapshot');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch dashboard snapshot',
    });
  }
});

/**
 * Analytics: Sharpe Ratio
 * Returns risk-adjusted return metric for PXI composite
 */
server.get('/v1/pxi/analytics/sharpe', async (request, reply) => {
  try {
    const cacheKey = 'analytics:sharpe';

    // Check cache
    if (config.cacheEnabled) {
      const cached = getFromCache<{ sharpe: number; riskFreeRate: number; daysAnalyzed: number }>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    // Fetch PXI history
    const pxiHistory = await getPXIHistory(90);

    if (pxiHistory.length < 2) {
      return reply.code(503).send({
        error: 'Insufficient data',
        message: 'Not enough historical PXI data for Sharpe ratio calculation'
      });
    }

    // Calculate daily returns
    const returns = pxiHistory.map((record, i) => {
      if (i === 0) return 0;
      const prevValue = pxiHistory[i - 1].pxiValue;
      return prevValue !== 0 ? (record.pxiValue - prevValue) / prevValue : 0;
    }).slice(1); // Remove first zero

    const sharpe = calculateSharpeRatio(returns, 0.02);

    const result = {
      sharpe: Number(sharpe.toFixed(4)),
      riskFreeRate: 0.02,
      daysAnalyzed: returns.length,
    };

    // Cache result
    if (config.cacheEnabled) {
      setInCache(cacheKey, result, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return result;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to calculate Sharpe ratio');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to calculate Sharpe ratio',
    });
  }
});

/**
 * Analytics: Max Drawdown
 * Returns peak-to-trough decline analysis
 */
server.get('/v1/pxi/analytics/drawdown', async (request, reply) => {
  try {
    const cacheKey = 'analytics:drawdown';

    // Check cache
    if (config.cacheEnabled) {
      const cached = getFromCache<ReturnType<typeof calculateMaxDrawdown> & { daysAnalyzed: number }>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    // Fetch PXI history
    const pxiHistory = await getPXIHistory(90);

    if (pxiHistory.length < 2) {
      return reply.code(503).send({
        error: 'Insufficient data',
        message: 'Not enough historical PXI data for drawdown calculation'
      });
    }

    const pxiValues = pxiHistory.map(record => record.pxiValue);
    const drawdown = calculateMaxDrawdown(pxiValues);

    const result = {
      ...drawdown,
      maxDrawdownPercent: Number((drawdown.maxDrawdownPercent * 100).toFixed(2)),
      peakTimestamp: pxiHistory[drawdown.peakIndex]?.timestamp,
      troughTimestamp: pxiHistory[drawdown.troughIndex]?.timestamp,
      daysAnalyzed: pxiValues.length,
    };

    // Cache result
    if (config.cacheEnabled) {
      setInCache(cacheKey, result, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return result;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to calculate max drawdown');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to calculate max drawdown',
    });
  }
});

/**
 * Analytics: Comprehensive Risk Metrics
 * Returns Sharpe ratio, Sortino ratio, max drawdown, volatility, and cumulative return
 */
server.get('/v1/pxi/analytics/risk-metrics', async (request, reply) => {
  try {
    const cacheKey = 'analytics:risk-metrics';

    // Check cache
    if (config.cacheEnabled) {
      const cached = getFromCache<{
        sharpe: number;
        sortino: number;
        maxDrawdown: ReturnType<typeof calculateMaxDrawdown>;
        volatility: number;
        cumulativeReturn: number;
        daysAnalyzed: number;
      }>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    // Fetch PXI history
    const pxiHistory = await getPXIHistory(90);

    if (pxiHistory.length < 2) {
      return reply.code(503).send({
        error: 'Insufficient data',
        message: 'Not enough historical PXI data for risk metrics calculation'
      });
    }

    const pxiValues = pxiHistory.map(record => record.pxiValue);

    // Calculate daily returns
    const returns = pxiHistory.map((record, i) => {
      if (i === 0) return 0;
      const prevValue = pxiHistory[i - 1].pxiValue;
      return prevValue !== 0 ? (record.pxiValue - prevValue) / prevValue : 0;
    }).slice(1); // Remove first zero

    const sharpe = calculateSharpeRatio(returns, 0.02);
    const sortino = calculateSortinoRatio(returns, 0.02);
    const drawdown = calculateMaxDrawdown(pxiValues);
    const volatility = calculateVolatility(returns);
    const cumulativeReturn = calculateCumulativeReturn(returns);

    const result = {
      sharpe: Number(sharpe.toFixed(4)),
      sortino: Number(sortino.toFixed(4)),
      maxDrawdown: {
        ...drawdown,
        maxDrawdownPercent: Number((drawdown.maxDrawdownPercent * 100).toFixed(2)),
        peakTimestamp: pxiHistory[drawdown.peakIndex]?.timestamp,
        troughTimestamp: pxiHistory[drawdown.troughIndex]?.timestamp,
      },
      volatility: Number((volatility * 100).toFixed(2)), // Convert to percentage
      cumulativeReturn: Number((cumulativeReturn * 100).toFixed(2)), // Convert to percentage
      daysAnalyzed: returns.length,
    };

    // Cache result
    if (config.cacheEnabled) {
      setInCache(cacheKey, result, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return result;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to calculate risk metrics');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to calculate risk metrics',
    });
  }
});

/**
 * Alerts Endpoint
 * Fetch recent PXI alerts (warnings and critical)
 */
server.get('/v1/pxi/alerts', async (request, reply) => {
  try {
    const query = `
      SELECT
        alert_type,
        indicator_id,
        timestamp,
        raw_value,
        z_score,
        weight,
        contribution,
        threshold,
        message,
        severity,
        acknowledged,
        created_at
      FROM alerts
      WHERE acknowledged = false
        AND timestamp >= NOW() - INTERVAL '7 days'
      ORDER BY timestamp DESC, severity DESC
      LIMIT 50
    `;

    const result = await pool.query(query);

    return {
      alerts: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch alerts');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch alerts',
    });
  }
});

/**
 * BTC Indicator Cache Status
 * Shows when indicators were last updated and cache freshness
 */
server.get('/v1/pxi/indicators/cache-status', async (request, reply) => {
  try {
    const cached = await fetchLatestIndicators();

    if (!cached) {
      return reply.code(404).send({
        cached: false,
        message: 'No cached indicators found - daily worker has not run yet',
      });
    }

    const now = Date.now();
    const updatedAt = new Date(cached.updatedAt).getTime();
    const ageMs = now - updatedAt;
    const ageHours = ageMs / (1000 * 60 * 60);

    const STALE_THRESHOLD = 48; // hours
    const WARNING_THRESHOLD = 36; // hours

    let status: 'fresh' | 'warning' | 'stale';
    if (ageHours > STALE_THRESHOLD) {
      status = 'stale';
    } else if (ageHours > WARNING_THRESHOLD) {
      status = 'warning';
    } else {
      status = 'fresh';
    }

    return {
      cached: true,
      status,
      date: cached.date,
      updatedAt: cached.updatedAt,
      ageHours: Number(ageHours.toFixed(1)),
      thresholds: {
        warning: WARNING_THRESHOLD,
        stale: STALE_THRESHOLD,
      },
      indicators: {
        rsi: cached.rsi !== null ? Number(cached.rsi.toFixed(2)) : null,
        macdValue: cached.macdValue !== null ? Number(cached.macdValue.toFixed(2)) : null,
        macdSignal: cached.macdSignal !== null ? Number(cached.macdSignal.toFixed(2)) : null,
        signalMultiplier: Number(cached.signalMultiplier.toFixed(3)),
      },
      nextUpdate: 'Twice daily at 00:05 and 12:05 UTC',
    };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch indicator cache status');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch cache status',
    });
  }
});

/**
 * Historical PXI Data
 * Returns time-series PXI data for charting
 */
server.get('/v1/pxi/history', async (request, reply) => {
  try {
    const { days = 30 } = request.query as { days?: number };
    const daysToFetch = Math.min(Math.max(Number(days) || 30, 1), 90); // Limit to 1-90 days

    const cacheKey = `pxi:history:${daysToFetch}`;

    // Check cache
    if (config.cacheEnabled) {
      const cached = getFromCache<Awaited<ReturnType<typeof getPXIHistory>>>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return { history: cached, days: daysToFetch };
      }
    }

    const history = await getPXIHistory(daysToFetch);

    // Cache the result
    if (config.cacheEnabled) {
      setInCache(cacheKey, history, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return {
      history,
      days: daysToFetch,
      count: history.length,
    };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch PXI history');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch PXI history',
    });
  }
});

/**
 * Metrics endpoint for monitoring
 */
server.get('/metrics', async () => {
  return {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cacheSize: cache.size,
    timestamp: new Date().toISOString(),
  };
});
/**
 * V1 API: Get latest regime detection
 */
server.get('/v1/pxi/regime/latest', async (request, reply) => {
  try {
    // Check cache first
    if (config.cacheEnabled) {
      const cached = getFromCache<any>('pxi:regime:latest');
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    const query = `
      SELECT
        date,
        regime,
        cluster_id,
        features,
        centroid,
        probabilities,
        created_at
      FROM pxi_regimes
      ORDER BY date DESC
      LIMIT 1
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return reply.code(404).send({ message: 'No regime data available' });
    }

    const row = result.rows[0];
    const regimeData = {
      date: row.date,
      regime: row.regime,
      clusterId: row.cluster_id,
      features: row.features,
      centroid: row.centroid,
      probabilities: row.probabilities,
      createdAt: row.created_at,
    };

    // Cache the response
    if (config.cacheEnabled) {
      setInCache('pxi:regime:latest', regimeData, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return regimeData;
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch latest regime');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch regime data',
    });
  }
});

/**
 * V1 API: Get regime detection history
 */
server.get('/v1/pxi/regime/history', async (request, reply) => {
  try {
    // Parse query parameters
    const { days = '30' } = request.query as { days?: string };
    const daysInt = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);

    // Check cache first
    const cacheKey = `pxi:regime:history:${daysInt}`;
    if (config.cacheEnabled) {
      const cached = getFromCache<any[]>(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return { regimes: cached, days: daysInt };
      }
    }

    const query = `
      SELECT
        date,
        regime,
        cluster_id,
        features,
        centroid,
        probabilities,
        created_at
      FROM pxi_regimes
      WHERE date >= CURRENT_DATE - INTERVAL '${daysInt} days'
      ORDER BY date DESC
    `;

    const result = await pool.query(query);

    const regimes = result.rows.map((row) => ({
      date: row.date,
      regime: row.regime,
      clusterId: row.cluster_id,
      features: row.features,
      centroid: row.centroid,
      probabilities: row.probabilities,
      createdAt: row.created_at,
    }));

    // Cache the response
    if (config.cacheEnabled) {
      setInCache(cacheKey, regimes, config.cacheTtlSeconds);
      reply.header('X-Cache', 'MISS');
    }

    return { regimes, days: daysInt };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to fetch regime history');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'Failed to fetch regime history',
    });
  }
});

/**
 * POST /v1/pxi/backtest
 * Run backtest with regime filtering
 */
server.post('/v1/pxi/backtest', async (request, reply) => {
  try {
    const backtestConfig = request.body as BacktestConfig;

    // Validate config
    if (!backtestConfig.startDate || !backtestConfig.endDate || !backtestConfig.rules) {
      return reply.code(400).send({
        error: 'Bad request',
        message: 'Missing required fields: startDate, endDate, rules',
      });
    }

    // Run backtest
    const result = await runBacktest(backtestConfig);

    return { success: true, result };
  } catch (error) {
    logger.error({ error, reqId: request.id }, 'Failed to run backtest');
    return reply.code(500).send({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Failed to run backtest',
    });
  }
});

/**
 * Start the server
 */
const start = async (): Promise<void> => {
  try {
    // Test database connection before starting
    await testConnection();
    logger.info('Database connection verified');

    // Register plugins
    await registerPlugins();

    // Start listening
    await server.listen({ port: config.port, host: config.host });
    logger.info({ port: config.port, host: config.host }, 'API server running');
  } catch (error) {
    logger.error({ error }, 'Failed to start API server');
    process.exit(1);
  }
};

/**
 * Graceful shutdown handler
 */
const shutdown = async (): Promise<void> => {
  logger.info('Shutting down API server gracefully');
  try {
    await server.close();
    await pool.end();
    logger.info('Server shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception');
  shutdown();
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  shutdown();
});

start();
