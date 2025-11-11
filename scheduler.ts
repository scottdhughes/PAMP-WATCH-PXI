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
 * Also runs daily regime detection at 02:30 UTC:
 * - K-means clustering (k=3, seeded) for regime classification
 * - Feature extraction from z-scores and rolling volatilities
 * - Automatic labeling as Calm/Normal/Stress
 *
 * Features:
 * - Robust error handling with retry logic
 * - Sequential execution (ingest → compute)
 * - Nightly validation for data quality assurance
 * - Daily regime detection with clustering
 * - Health monitoring and metrics tracking
 * - Graceful shutdown
 * - Prevents overlapping runs
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';
import { pool } from './db.js';

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

// Metrics tracking - Regime Detection
let lastRegimeRun: Date | null = null;
let lastRegimeStatus: 'success' | 'fail' | null = null;
let totalRegimeRuns = 0;
let totalRegimeSuccesses = 0;
let totalRegimeFailures = 0;

// Alert configuration
const ALERT_ENABLED = process.env.ALERT_ENABLED === 'true';
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

// Regime transition tracking
let previousRegime: string | null = null;

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
 * Send webhook alert for regime transition
 */
async function sendRegimeAlert(
  previousRegime: string,
  currentRegime: string,
  pxiValue: number,
  metrics: { vix?: number; hyOas?: number }
): Promise<void> {
  if (!ALERT_ENABLED || !ALERT_WEBHOOK_URL) {
    logger.debug('Alerts disabled or webhook URL not configured');
    return;
  }

  const regimeEmojis: Record<string, string> = {
    'Calm': '🌊',
    'Normal': '⚖️',
    'Stress': '🔥',
  };

  const date = new Date().toISOString().split('T')[0];
  const message = `🚨 PXI Regime Change: ${previousRegime} ${regimeEmojis[previousRegime] || ''} → ${currentRegime} ${regimeEmojis[currentRegime] || ''}
Date: ${date}
PXI: ${pxiValue.toFixed(3)} | VIX: ${metrics.vix?.toFixed(1) || 'N/A'} | HY OAS: ${metrics.hyOas ? (metrics.hyOas * 100).toFixed(2) + '%' : 'N/A'}`;

  try {
    const response = await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });

    if (!response.ok) {
      throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
    }

    logger.info({ previousRegime, currentRegime, date }, '📨 Regime transition alert sent');
  } catch (error) {
    logger.error({ error: (error as Error).message }, '❌ Failed to send regime transition alert');
  }
}

/**
 * Check for regime changes and send alerts
 */
async function checkRegimeChange(): Promise<void> {
  try {
    // Fetch latest regime from database
    const regimeResult = await pool.query(
      `SELECT regime, probabilities
       FROM pxi_regimes
       ORDER BY date DESC
       LIMIT 1`
    );

    if (regimeResult.rows.length === 0) {
      logger.warn('No regime data available for change detection');
      return;
    }

    const currentRegime = regimeResult.rows[0].regime;
    const probabilities = regimeResult.rows[0].probabilities;
    const pxiValue = probabilities?.pxiValue || 0;
    const rawMetrics = probabilities?.rawMetrics || {};

    // Check if regime has changed
    if (previousRegime && previousRegime !== currentRegime) {
      logger.info(
        { previousRegime, currentRegime },
        '🔄 Regime transition detected'
      );

      await sendRegimeAlert(
        previousRegime,
        currentRegime,
        pxiValue,
        {
          vix: rawMetrics.vix?.value,
          hyOas: rawMetrics.hyOas?.value,
        }
      );
    }

    // Update previous regime
    previousRegime = currentRegime;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to check regime change');
  }
}

/**
 * Run regime detection (k-means clustering)
 */
async function runRegimeDetection(): Promise<void> {
  totalRegimeRuns++;
  const startTime = Date.now();

  try {
    logger.info('🎯 Starting regime detection (k-means clustering)');

    const result = await executeWithRetry('npm run worker:compute:regime');

    const duration = Date.now() - startTime;
    lastRegimeRun = new Date();
    lastRegimeStatus = 'success';
    totalRegimeSuccesses++;

    // Extract key metrics from output
    const daysMatch = result.stdout.match(/days: (\d+)/);
    const regimesMatch = result.stdout.match(/distribution: \{([^}]+)\}/);

    const days = daysMatch ? daysMatch[1] : 'unknown';
    const distribution = regimesMatch ? regimesMatch[1] : 'unknown';

    logger.info(
      {
        days,
        distribution,
        duration,
        regimeSuccessRate: totalRegimeRuns > 0
          ? ((totalRegimeSuccesses / totalRegimeRuns) * 100).toFixed(1) + '%'
          : '0%',
      },
      '✅ Regime detection completed successfully'
    );

    // Check for regime changes and send alerts
    await checkRegimeChange();
  } catch (error) {
    lastRegimeRun = new Date();
    lastRegimeStatus = 'fail';
    totalRegimeFailures++;
    const duration = Date.now() - startTime;

    logger.error(
      {
        error: (error as Error).message,
        duration,
        regimeFailRate: totalRegimeRuns > 0
          ? ((totalRegimeFailures / totalRegimeRuns) * 100).toFixed(1) + '%'
          : '0%',
      },
      '❌ Regime detection failed'
    );
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
    regime: {
      lastRun: lastRegimeRun?.toISOString() || null,
      lastStatus: lastRegimeStatus,
      totalRuns: totalRegimeRuns,
      successes: totalRegimeSuccesses,
      failures: totalRegimeFailures,
      successRate: totalRegimeRuns > 0
        ? ((totalRegimeSuccesses / totalRegimeRuns) * 100).toFixed(1) + '%'
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

  // Initialize previous regime for change detection
  try {
    const regimeResult = await pool.query(
      'SELECT regime FROM pxi_regimes ORDER BY date DESC LIMIT 1'
    );
    if (regimeResult.rows.length > 0) {
      previousRegime = regimeResult.rows[0].regime;
      logger.info({ previousRegime }, 'Initialized regime tracking');
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, 'Failed to initialize regime tracking');
  }

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

  // Schedule daily regime detection (02:30 UTC)
  const regimeTask = cron.schedule('30 2 * * *', async () => {
    await runRegimeDetection();
  });

  regimeTask.start();
  logger.info({ schedule: '30 2 * * *' }, '✅ Daily regime detection scheduler started');

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
