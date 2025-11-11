#!/usr/bin/env node
/**
 * PXI Real-Time Data Scheduler
 *
 * Continuously ingests all 7 metrics and computes PXI every minute:
 * - HY OAS, IG OAS, VIX, U3, USD, NFCI, BTC Returns
 *
 * Also runs nightly data validation at 2 AM:
 * - Statistical sanity checks (outliers, flatlines, invalid values)
 * - Correlation analysis and structural shift detection
 * - Data quality monitoring with health status tracking
 *
 * Features:
 * - Robust error handling with retry logic
 * - Sequential execution (ingest → compute)
 * - Nightly validation for data quality assurance
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
const VALIDATION_SCHEDULE = '0 2 * * *'; // 2 AM daily
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds
const EXECUTION_TIMEOUT_MS = 55000; // 55 seconds (before next cron)

// Metrics tracking - Data Pipeline
let lastSuccessfulRun: Date | null = null;
let consecutiveFailures = 0;
let totalRuns = 0;
let totalSuccesses = 0;
let totalFailures = 0;
let isRunning = false;

// Metrics tracking - Validation
let lastValidationRun: Date | null = null;
let lastValidationStatus: 'pass' | 'fail' | null = null;
let totalValidationRuns = 0;
let totalValidationPasses = 0;
let totalValidationFailures = 0;

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
 * Run nightly data validation
 */
async function runValidation(): Promise<void> {
  totalValidationRuns++;
  const startTime = Date.now();

  try {
    logger.info('🔍 Starting nightly data validation');

    // Run validation script (note: script exits with code 1 if validation fails)
    const result = await execAsync('tsx scripts/validate-data.ts', {
      maxBuffer: 10 * 1024 * 1024
    });

    const duration = Date.now() - startTime;
    lastValidationRun = new Date();
    lastValidationStatus = 'pass';
    totalValidationPasses++;

    // Extract key metrics from output
    const metricsValidatedMatch = result.stdout.match(/metricsValidated: (\d+)/);
    const passedMatch = result.stdout.match(/passed: (\d+)/);
    const failedMatch = result.stdout.match(/failed: (\d+)/);

    const metricsValidated = metricsValidatedMatch ? metricsValidatedMatch[1] : 'unknown';
    const passed = passedMatch ? passedMatch[1] : 'unknown';
    const failed = failedMatch ? failedMatch[1] : 'unknown';

    logger.info(
      {
        metricsValidated,
        passed,
        failed,
        duration,
        validationPassRate: totalValidationRuns > 0
          ? ((totalValidationPasses / totalValidationRuns) * 100).toFixed(1) + '%'
          : '0%',
      },
      '✅ Validation completed successfully'
    );
  } catch (error) {
    lastValidationRun = new Date();
    lastValidationStatus = 'fail';
    totalValidationFailures++;
    const duration = Date.now() - startTime;

    // Parse error output for details
    const errorMessage = (error as any).message || 'Unknown error';
    const stderr = (error as any).stderr || '';
    const stdout = (error as any).stdout || '';

    // Extract anomaly information if present
    const brokenMetrics = stdout.match(/brokenMetrics: \[([^\]]*)\]/);
    const anomalies = stdout.match(/anomalies: \[([^\]]*)\]/);

    logger.warn(
      {
        error: errorMessage,
        brokenMetrics: brokenMetrics ? brokenMetrics[1] : 'none',
        anomalies: anomalies ? anomalies[1] : 'none',
        duration,
        validationFailRate: totalValidationRuns > 0
          ? ((totalValidationFailures / totalValidationRuns) * 100).toFixed(1) + '%'
          : '0%',
      },
      '⚠️  Validation failed - anomalies detected'
    );

    // Log warning but don't treat as critical failure (data anomalies are expected)
    logger.info('Validation failures indicate data quality issues, not system errors');
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
    validation: {
      lastRun: lastValidationRun?.toISOString() || null,
      lastStatus: lastValidationStatus,
      totalRuns: totalValidationRuns,
      passes: totalValidationPasses,
      failures: totalValidationFailures,
      passRate: totalValidationRuns > 0
        ? ((totalValidationPasses / totalValidationRuns) * 100).toFixed(1) + '%'
        : '0%',
    },
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
  logger.info('✅ Data pipeline scheduler started successfully');

  // Schedule nightly validation
  const validationTask = cron.schedule(VALIDATION_SCHEDULE, async () => {
    await runValidation();
  });

  validationTask.start();
  logger.info({ schedule: VALIDATION_SCHEDULE }, '✅ Nightly validation scheduler started');

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
