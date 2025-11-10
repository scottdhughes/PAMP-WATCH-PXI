import { Pool, PoolClient } from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';
import type { CompositeRecord } from './shared/types.js';

/**
 * PostgreSQL connection pool with error handling
 */
export const pool = new Pool({
  connectionString: config.postgresUrl,
  max: config.dbPoolMax,
  min: config.dbPoolMin,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error({ error: err }, 'Unexpected database pool error');
});

// Handle pool connection
pool.on('connect', () => {
  logger.debug('New database client connected to pool');
});

/**
 * Tests database connectivity
 *
 * @returns Promise that resolves to true if connection successful
 * @throws Error if connection fails
 */
export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('Database connection test successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection test failed');
    throw new Error(`Database connection failed: ${(error as Error).message}`);
  }
};

/**
 * Upserts metric samples into the database
 *
 * @param samples - Array of metric samples to insert
 * @throws Error if database operation fails
 */
export const upsertMetricSamples = async (
  samples: Array<{
    id: string;
    label: string;
    value: number;
    unit: string;
    sourceTimestamp: string;
    ingestedAt: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<void> => {
  if (!samples.length) return;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const insertText = `
      INSERT INTO pxi_metric_samples
        (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
      VALUES
        ${samples
          .map((_, idx) =>
            `($${idx * 7 + 1}, $${idx * 7 + 2}, $${idx * 7 + 3}, $${idx * 7 + 4}, $${idx * 7 + 5}, $${idx * 7 + 6}, $${idx * 7 + 7})`,
          )
          .join(', ')}
      ON CONFLICT (metric_id, source_timestamp)
      DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, ingested_at = EXCLUDED.ingested_at;
    `;
    const values = samples.flatMap((sample) => [
      sample.id,
      sample.label,
      sample.value,
      sample.unit,
      sample.sourceTimestamp,
      sample.ingestedAt,
      sample.metadata ?? {},
    ]);

    await client.query(insertText, values);
    logger.info({ count: samples.length }, 'Metric samples upserted successfully');
  } catch (error) {
    logger.error({ error, sampleCount: samples.length }, 'Failed to upsert metric samples');
    throw new Error(`Database upsert failed: ${(error as Error).message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetches the latest composite records from the database
 *
 * @param limit - Number of records to fetch (default: 1)
 * @returns Array of composite records
 */
export const fetchLatestComposites = async (limit = 1): Promise<CompositeRecord[]> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT id, calculated_at as "calculatedAt", z_score as "zScore", pxi, metrics, breaches
       FROM pxi_composites
       ORDER BY calculated_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows as CompositeRecord[];
  } catch (error) {
    logger.error({ error }, 'Failed to fetch latest composites');
    throw new Error(`Failed to fetch composites: ${(error as Error).message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Gracefully closes the database pool
 */
export const closePool = async (): Promise<void> => {
  try {
    await pool.end();
    logger.info('Database pool closed successfully');
  } catch (error) {
    logger.error({ error }, 'Error closing database pool');
  }
};
