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
 * Fetches the latest metric samples from the database
 *
 * @returns Array of latest metric samples, one per metric
 */
export const fetchLatestMetricSamples = async (): Promise<
  Array<{
    metricId: string;
    metricLabel: string;
    value: number;
    unit: string;
    sourceTimestamp: string;
  }>
> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(`
      SELECT DISTINCT ON (metric_id)
        metric_id as "metricId",
        metric_label as "metricLabel",
        value,
        unit,
        source_timestamp as "sourceTimestamp"
      FROM pxi_metric_samples
      ORDER BY metric_id, source_timestamp DESC
    `);
    logger.info({ count: result.rows.length }, 'Fetched latest metric samples');
    return result.rows;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch latest metric samples');
    throw new Error(`Failed to fetch metric samples: ${(error as Error).message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts a new composite record into the database
 *
 * @param composite - Composite data to insert
 * @returns The inserted composite record with ID
 */
export const insertComposite = async (composite: {
  calculatedAt: string;
  zScore: number;
  pxi: number;
  metrics: Array<{
    id: string;
    value: number;
    zScore: number;
    contribution: number;
  }>;
  breaches: {
    pamp: string[];
    stress: string[];
    systemLevel: string | null;
  };
}): Promise<CompositeRecord> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO pxi_composites
        (calculated_at, z_score, pxi, metrics, breaches)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, calculated_at as "calculatedAt", z_score as "zScore", pxi, metrics, breaches`,
      [
        composite.calculatedAt,
        composite.zScore,
        composite.pxi,
        JSON.stringify(composite.metrics),
        JSON.stringify(composite.breaches),
      ],
    );
    logger.info({ pxi: composite.pxi }, 'Composite record inserted successfully');
    return result.rows[0] as CompositeRecord;
  } catch (error) {
    logger.error({ error }, 'Failed to insert composite record');
    throw new Error(`Failed to insert composite: ${(error as Error).message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetches latest rolling statistics for all indicators
 *
 * @returns Map of indicator ID to { mean, stddev }
 */
export const fetchLatestStats = async (): Promise<
  Map<string, { mean: number; stddev: number; sampleCount: number }>
> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(`
      SELECT indicator_id, mean_value, stddev_value, sample_count
      FROM latest_stats
    `);

    const statsMap = new Map();
    result.rows.forEach((row) => {
      statsMap.set(row.indicator_id, {
        mean: row.mean_value,
        stddev: row.stddev_value,
        sampleCount: row.sample_count,
      });
    });

    logger.info({ count: statsMap.size }, 'Fetched latest statistics');
    return statsMap;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch latest statistics');
    throw new Error(`Failed to fetch stats: ${(error as Error).message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts z-scores into the database
 */
export const insertZScores = async (
  zScores: Array<{
    indicatorId: string;
    timestamp: string;
    rawValue: number;
    meanValue: number;
    stddevValue: number;
    zScore: number;
  }>,
): Promise<void> => {
  if (!zScores.length) return;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const insertText = `
      INSERT INTO z_scores
        (indicator_id, timestamp, raw_value, mean_value, stddev_value, z_score)
      VALUES
        ${zScores
          .map((_, idx) => `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}, $${idx * 6 + 6})`)
          .join(', ')}
      ON CONFLICT (indicator_id, timestamp)
      DO UPDATE SET raw_value = EXCLUDED.raw_value, z_score = EXCLUDED.z_score
    `;
    const values = zScores.flatMap((z) => [
      z.indicatorId,
      z.timestamp,
      z.rawValue,
      z.meanValue,
      z.stddevValue,
      z.zScore,
    ]);

    await client.query(insertText, values);
    logger.info({ count: zScores.length }, 'Z-scores inserted successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to insert z-scores');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts contributions into the database
 */
export const insertContributions = async (
  contributions: Array<{
    indicatorId: string;
    timestamp: string;
    rawValue: number;
    zScore: number;
    baseWeight: number;
    actualWeight: number;
    weightMultiplier: number;
    normalizedWeight: number;
    contribution: number;
  }>,
): Promise<void> => {
  if (!contributions.length) return;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const insertText = `
      INSERT INTO contributions
        (indicator_id, timestamp, raw_value, z_score, base_weight, actual_weight, weight_multiplier, normalized_weight, contribution)
      VALUES
        ${contributions
          .map((_, idx) =>
            `($${idx * 9 + 1}, $${idx * 9 + 2}, $${idx * 9 + 3}, $${idx * 9 + 4}, $${idx * 9 + 5}, $${idx * 9 + 6}, $${idx * 9 + 7}, $${idx * 9 + 8}, $${idx * 9 + 9})`
          )
          .join(', ')}
      ON CONFLICT (indicator_id, timestamp)
      DO UPDATE SET
        contribution = EXCLUDED.contribution,
        actual_weight = EXCLUDED.actual_weight,
        normalized_weight = EXCLUDED.normalized_weight
    `;
    const values = contributions.flatMap((c) => [
      c.indicatorId,
      c.timestamp,
      c.rawValue,
      c.zScore,
      c.baseWeight,
      c.actualWeight,
      c.weightMultiplier,
      c.normalizedWeight,
      c.contribution,
    ]);

    await client.query(insertText, values);
    logger.info({ count: contributions.length }, 'Contributions inserted successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to insert contributions');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts composite PXI regime record
 */
export const insertCompositePxiRegime = async (composite: {
  timestamp: string;
  pxiValue: number;
  pxiZScore: number;
  regime: string;
  totalWeight: number;
  pampCount: number;
  stressCount: number;
}): Promise<void> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO composite_pxi_regime
        (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (timestamp)
      DO UPDATE SET pxi_value = EXCLUDED.pxi_value, regime = EXCLUDED.regime`,
      [
        composite.timestamp,
        composite.pxiValue,
        composite.pxiZScore,
        composite.regime,
        composite.totalWeight,
        composite.pampCount,
        composite.stressCount,
      ],
    );
    logger.info({ regime: composite.regime, pxi: composite.pxiValue }, 'Composite PXI regime inserted');
  } catch (error) {
    logger.error({ error }, 'Failed to insert composite PXI regime');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts alerts into the database
 */
export const insertAlerts = async (
  alerts: Array<{
    alertType: string;
    indicatorId: string | null;
    timestamp: string;
    rawValue: number | null;
    zScore: number | null;
    weight: number | null;
    contribution: number | null;
    threshold: number | null;
    message: string;
    severity: 'info' | 'warning' | 'critical';
  }>,
): Promise<void> => {
  if (!alerts.length) return;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const insertText = `
      INSERT INTO alerts
        (alert_type, indicator_id, timestamp, raw_value, z_score, weight, contribution, threshold, message, severity)
      VALUES
        ${alerts
          .map((_, idx) =>
            `($${idx * 10 + 1}, $${idx * 10 + 2}, $${idx * 10 + 3}, $${idx * 10 + 4}, $${idx * 10 + 5}, $${idx * 10 + 6}, $${idx * 10 + 7}, $${idx * 10 + 8}, $${idx * 10 + 9}, $${idx * 10 + 10})`
          )
          .join(', ')}
    `;
    const values = alerts.flatMap((a) => [
      a.alertType,
      a.indicatorId,
      a.timestamp,
      a.rawValue,
      a.zScore,
      a.weight,
      a.contribution,
      a.threshold,
      a.message,
      a.severity,
    ]);

    await client.query(insertText, values);
    logger.info({ count: alerts.length }, 'Alerts inserted successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to insert alerts');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Inserts historical values into the database (for live feed)
 */
export const insertHistoricalValues = async (
  values: Array<{
    indicatorId: string;
    date: string;
    rawValue: number;
    source: string;
  }>,
): Promise<void> => {
  if (!values.length) return;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const insertText = `
      INSERT INTO history_values
        (indicator_id, date, raw_value, source)
      VALUES
        ${values
          .map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`)
          .join(', ')}
      ON CONFLICT (indicator_id, date)
      DO UPDATE SET raw_value = EXCLUDED.raw_value, source = EXCLUDED.source
    `;
    const vals = values.flatMap((v) => [
      v.indicatorId,
      v.date,
      v.rawValue,
      v.source,
    ]);

    await client.query(insertText, vals);
    logger.info({ count: values.length }, 'Historical values inserted successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to insert historical values');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetches latest alerts from the database
 *
 * @param limit - Number of alerts to fetch (default: 10)
 * @param unacknowledgedOnly - Only fetch unacknowledged alerts
 * @returns Array of alert records
 */
export const fetchLatestAlerts = async (
  limit = 10,
  unacknowledgedOnly = true,
): Promise<
  Array<{
    id: number;
    alertType: string;
    indicatorId: string | null;
    timestamp: string;
    rawValue: number | null;
    zScore: number | null;
    weight: number | null;
    contribution: number | null;
    threshold: number | null;
    message: string;
    severity: 'info' | 'warning' | 'critical';
    acknowledged: boolean;
  }>
> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const whereClause = unacknowledgedOnly ? 'WHERE acknowledged = FALSE' : '';
    const result = await client.query(
      `SELECT id, alert_type as "alertType", indicator_id as "indicatorId",
              timestamp, raw_value as "rawValue", z_score as "zScore",
              weight, contribution, threshold, message, severity, acknowledged
       FROM alerts
       ${whereClause}
       ORDER BY timestamp DESC, id DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch alerts');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetches latest composite PXI regime
 *
 * @returns Latest regime record or null
 */
export const fetchLatestRegime = async (): Promise<{
  timestamp: string;
  pxiValue: number;
  pxiZScore: number;
  regime: string;
  totalWeight: number;
  pampCount: number;
  stressCount: number;
} | null> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT timestamp, pxi_value as "pxiValue", pxi_z_score as "pxiZScore",
              regime, total_weight as "totalWeight", pamp_count as "pampCount",
              stress_count as "stressCount"
       FROM composite_pxi_regime
       ORDER BY timestamp DESC
       LIMIT 1`,
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch latest regime');
    throw error;
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
