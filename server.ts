import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { buildLatestResponse } from './buildLatestResponse.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { pool, testConnection, getPXIHistory } from './db.js';
import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateVolatility,
  calculateCumulativeReturn,
  calculateSortinoRatio,
} from './utils/analytics.js';

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
