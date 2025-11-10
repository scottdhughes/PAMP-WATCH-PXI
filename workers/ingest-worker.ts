#!/usr/bin/env node
/**
 * Ingest Worker
 *
 * Fetches all 7 metrics from external APIs and stores them in the database.
 * Runs on a 1-minute cadence via cron or manual execution.
 */

import { metricFetchers } from '../fetchers.js';
import { validateSamples } from '../validator.js';
import { upsertMetricSamples, closePool } from '../db.js';
import { logger } from '../logger.js';
import type { MetricSample } from '../shared/types.js';

/**
 * Main ingestion logic
 */
async function ingestMetrics(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting metric ingestion cycle');

  try {
    // Fetch all metrics in parallel
    const results = await Promise.allSettled(
      metricFetchers.map((fetcher) => fetcher.fetch()),
    );

    // Separate successful and failed fetches
    const samples: MetricSample[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    results.forEach((result, index) => {
      const fetcher = metricFetchers[index];
      if (result.status === 'fulfilled') {
        samples.push(result.value);
        logger.info({ metricId: fetcher.id }, 'Metric fetched successfully');
      } else {
        const errorMsg = result.reason?.message ?? 'Unknown error';
        errors.push({ id: fetcher.id, error: errorMsg });
        logger.error(
          { metricId: fetcher.id, error: errorMsg },
          'Failed to fetch metric',
        );
      }
    });

    // Log summary
    logger.info(
      { successful: samples.length, failed: errors.length },
      'Fetch cycle complete',
    );

    // If we have no samples, exit early
    if (samples.length === 0) {
      logger.warn('No metrics fetched successfully, skipping validation and storage');
      return;
    }

    // Validate samples
    try {
      validateSamples(samples);
    } catch (validationError) {
      logger.error(
        { error: validationError },
        'Validation failed, skipping storage',
      );
      throw validationError;
    }

    // Store in database
    await upsertMetricSamples(samples);

    const duration = Date.now() - startTime;
    logger.info(
      { duration, count: samples.length },
      'Ingestion cycle completed successfully',
    );
  } catch (error) {
    logger.error({ error }, 'Ingestion cycle failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  try {
    await ingestMetrics();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in ingest worker');
    await closePool();
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection in ingest worker');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception in ingest worker');
  process.exit(1);
});

// Run the worker
main();
