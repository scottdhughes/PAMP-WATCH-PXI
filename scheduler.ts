#!/usr/bin/env node
/**
 * PXI Real-Time Data Scheduler
 *
 * Continuously ingests all 7 metrics and computes PXI every minute:
 * - HY OAS, IG OAS, VIX, U3, USD, NFCI, BTC Returns
 *
 * Features:
 * - Robust error handling with retry logic
 * - Sequential execution (ingest → compute)
 * - Health monitoring and metrics tracking
 * - Graceful shutdown
 * - Prevents overlapping runs
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

// Scheduler configuration
const CRON_SCHEDULE = '* * * * *'; // Every minute
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds
const EXECUTION_TIMEOUT_MS = 55000; // 55 seconds (before next cron)

// Metrics tracking
let lastSuccessfulRun: Date | null = null;
let consecutiveFailures = 0;
let totalRuns = 0;
let totalSuccesses = 0;
let totalFailures = 0;
let isRunning = false;

/**
 * Execute a command with timeout and retry logic
 */
async function executeWithRetry(
  command: string,
  maxRetries: number = MAX_RETRIES
): Promise<{ stdout: string; stderr: string }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ command, attempt, maxRetries }, 'Executing command');

      const result = await Promise.race([
        execAsync(command, { maxBuffer: 10 * 1024 * 1024 }), // 10MB buffer
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Command timeout')), EXECUTION_TIMEOUT_MS)
        ),
      ]);

      logger.info({ command, attempt }, 'Command executed successfully');
      return result as { stdout: string; stderr: string };
    } catch (error) {
      lastError = error as Error;
      logger.warn(
        { command, attempt, maxRetries, error: lastError.message },
        'Command execution failed'
      );

      if (attempt < maxRetries) {
        logger.info({ delayMs: RETRY_DELAY_MS }, 'Retrying after delay');
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError || new Error('Command failed after retries');
}

/**
 * Run the full data pipeline: ingest → compute
 */
async function runDataPipeline(): Promise<void> {
  if (isRunning) {
    logger.warn('Pipeline already running, skipping this cycle');
    return;
  }

  isRunning = true;
  totalRuns++;
  const startTime = Date.now();

  try {
    logger.info('🚀 Starting data pipeline cycle');

    // Step 1: Ingest fresh data from all APIs
    logger.info('📥 Step 1/2: Ingesting data (HY OAS, IG OAS, VIX, U3, USD, NFCI, BTC)');
    const ingestResult = await executeWithRetry('tsx workers/ingest-worker.ts');

    // Check if all metrics were fetched
    const successfulMetrics = (ingestResult.stdout.match(/Metric fetched successfully/g) || []).length;
    logger.info({ successfulMetrics }, 'Data ingestion completed');

    if (successfulMetrics < 7) {
      logger.warn(
        { successfulMetrics, expected: 7 },
        'Not all metrics were fetched successfully'
      );
    }

    // Step 2: Compute PXI with normalized weights
    logger.info('🧮 Step 2/2: Computing PXI with statistical z-scores');
    const computeResult = await executeWithRetry('tsx workers/compute-worker.ts');

    // Extract PXI value from output
    const pxiMatch = computeResult.stdout.match(/compositePxi: "([^"]+)"/);
    const regimeMatch = computeResult.stdout.match(/regime: "([^"]+)"/);
    const pxiValue = pxiMatch ? pxiMatch[1] : 'unknown';
    const regime = regimeMatch ? regimeMatch[1] : 'unknown';

    const duration = Date.now() - startTime;
    lastSuccessfulRun = new Date();
    consecutiveFailures = 0;
    totalSuccesses++;

    logger.info(
      {
        pxi: pxiValue,
        regime,
        duration,
        successRate: ((totalSuccesses / totalRuns) * 100).toFixed(1) + '%',
      },
      '✅ Pipeline cycle completed successfully'
    );
  } catch (error) {
    consecutiveFailures++;
    totalFailures++;
    const duration = Date.now() - startTime;

    logger.error(
      {
        error: (error as Error).message,
        consecutiveFailures,
        duration,
        failureRate: ((totalFailures / totalRuns) * 100).toFixed(1) + '%',
      },
      '❌ Pipeline cycle failed'
    );

    // Alert if too many consecutive failures
    if (consecutiveFailures >= 5) {
      logger.fatal(
        { consecutiveFailures },
        '🚨 ALERT: Too many consecutive failures - manual intervention required'
      );
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Get scheduler health metrics
 */
function getHealthMetrics() {
  const uptime = process.uptime();
  const now = new Date();
  const timeSinceLastSuccess = lastSuccessfulRun
    ? (now.getTime() - lastSuccessfulRun.getTime()) / 1000
    : null;

  return {
    uptime: Math.floor(uptime),
    lastSuccessfulRun: lastSuccessfulRun?.toISOString() || null,
    timeSinceLastSuccess: timeSinceLastSuccess ? Math.floor(timeSinceLastSuccess) : null,
    totalRuns,
    totalSuccesses,
    totalFailures,
    consecutiveFailures,
    successRate: totalRuns > 0 ? ((totalSuccesses / totalRuns) * 100).toFixed(1) + '%' : '0%',
    isRunning,
  };
}

/**
 * Log health metrics every 5 minutes
 */
function startHealthMonitoring() {
  setInterval(() => {
    const metrics = getHealthMetrics();
    logger.info(metrics, '📊 Scheduler health metrics');

    // Warn if no successful run in 10 minutes
    if (metrics.timeSinceLastSuccess && metrics.timeSinceLastSuccess > 600) {
      logger.warn(
        { timeSinceLastSuccess: metrics.timeSinceLastSuccess },
        '⚠️  No successful run in over 10 minutes'
      );
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

/**
 * Main scheduler initialization
 */
async function main() {
  logger.info('🎯 PXI Real-Time Scheduler starting...');
  logger.info({ schedule: CRON_SCHEDULE }, 'Cron schedule configured');

  // Initial health check
  logger.info(getHealthMetrics(), 'Initial health metrics');

  // Run immediately on startup
  logger.info('Running initial pipeline cycle');
  await runDataPipeline();

  // Schedule recurring runs
  const task = cron.schedule(CRON_SCHEDULE, async () => {
    await runDataPipeline();
  });

  task.start();
  logger.info('✅ Scheduler started successfully');

  // Start health monitoring
  startHealthMonitoring();

  // Log status every minute
  setInterval(() => {
    const metrics = getHealthMetrics();
    logger.debug(
      {
        successRate: metrics.successRate,
        lastRun: metrics.lastSuccessfulRun,
      },
      'Scheduler status'
    );
  }, 60 * 1000);
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string) {
  logger.info({ signal }, 'Received shutdown signal');

  if (isRunning) {
    logger.info('Waiting for current pipeline cycle to complete');
    // Wait up to 30 seconds for current run to complete
    const maxWait = 30000;
    const startWait = Date.now();
    while (isRunning && Date.now() - startWait < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const finalMetrics = getHealthMetrics();
  logger.info(finalMetrics, '📊 Final scheduler metrics');
  logger.info('Scheduler shutdown complete');
  process.exit(0);
}

// Signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Error handlers
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in scheduler');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in scheduler');
  process.exit(1);
});

// Start the scheduler
main().catch((error) => {
  logger.fatal({ error }, 'Fatal error starting scheduler');
  process.exit(1);
});
