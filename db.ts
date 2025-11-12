import { Pool, PoolClient } from 'pg';
import { mean, std } from 'mathjs';
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
 * Calculate z-score for a metric value given historical data
 */
/**
 * Resample time series data to daily frequency (last value per day)
 * This ensures all metrics are comparable regardless of their native update frequency
 * (e.g., BTC updates minutely, VIX updates daily, NFCI updates monthly)
 */
const resampleToDaily = (data: Array<{ value: number; timestamp: Date }>): number[] => {
  // Group by date (YYYY-MM-DD)
  const dailyMap = new Map<string, { value: number; timestamp: Date }>();

  for (const point of data) {
    const dateKey = point.timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
    const existing = dailyMap.get(dateKey);

    // Keep the latest value for each day (market close)
    if (!existing || point.timestamp > existing.timestamp) {
      dailyMap.set(dateKey, point);
    }
  }

  // Extract values in chronological order
  const sortedDates = Array.from(dailyMap.keys()).sort();
  return sortedDates.map(date => dailyMap.get(date)!.value);
};

/**
 * Calculate z-score from daily-resampled historical data
 * Uses rolling 90-day window with daily frequency normalization
 */
const calculateZScore = (
  value: number,
  historicalData: Array<{ value: number; timestamp: Date }>
): number | null => {
  // Resample to daily frequency first
  const dailyValues = resampleToDaily(historicalData);

  if (dailyValues.length < 5) {
    return null; // Not enough daily data for meaningful statistics
  }

  const μ = mean(dailyValues) as number;
  const σ = std(dailyValues, 'unbiased') as number;

  // Handle flatline data (zero standard deviation)
  if (σ < 1e-9) {
    return 0;
  }

  return (value - μ) / σ;
};

/**
 * Upserts metric samples into the database with z-score calculation
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

    // Step 1: Insert raw samples without z-scores
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

    // Step 2: Calculate and update z-scores for each metric
    const uniqueMetrics = [...new Set(samples.map((s) => s.id))];

    // Optimization: Fetch all historical data in a single query
    const historicalResult = await client.query(
      `SELECT metric_id, value, source_timestamp
       FROM pxi_metric_samples
       WHERE metric_id = ANY($1)
         AND source_timestamp >= NOW() - INTERVAL '90 days'
       ORDER BY metric_id, source_timestamp ASC`,
      [uniqueMetrics]
    );

    // Group historical data by metric_id for efficient lookups
    const historicalByMetric = new Map<string, Array<{ value: number; timestamp: Date }>>();
    historicalResult.rows.forEach((r) => {
      if (!historicalByMetric.has(r.metric_id)) {
        historicalByMetric.set(r.metric_id, []);
      }
      historicalByMetric.get(r.metric_id)!.push({
        value: Number(r.value),
        timestamp: new Date(r.source_timestamp),
      });
    });

    // Calculate z-scores for all samples and collect updates
    const zScoreUpdates: Array<{ metricId: string; timestamp: string; zScore: number }> = [];

    for (const metricId of uniqueMetrics) {
      const metricSamples = samples.filter((s) => s.id === metricId);
      const historicalData = historicalByMetric.get(metricId) || [];

      for (const sample of metricSamples) {
        const sampleTimestamp = new Date(sample.sourceTimestamp);
        const windowStart = new Date(sampleTimestamp);
        windowStart.setDate(windowStart.getDate() - 90);

        // Filter historical data to rolling window BEFORE sample timestamp
        // Pass full { value, timestamp } objects for daily resampling
        const relevantHistory = historicalData
          .filter((h) => h.timestamp >= windowStart && h.timestamp < sampleTimestamp);

        const zScore = calculateZScore(sample.value, relevantHistory);

        if (zScore !== null) {
          zScoreUpdates.push({
            metricId,
            timestamp: sample.sourceTimestamp,
            zScore,
          });

          logger.debug({
            metricId,
            sampleTimestamp: sample.sourceTimestamp,
            rawDataPoints: relevantHistory.length,
            dailyDataPoints: resampleToDaily(relevantHistory).length,
            zScore: zScore.toFixed(3),
          }, 'Z-score calculated with daily resampling');
        }
      }
    }

    // Batch update z-scores using a temporary table (more efficient than individual UPDATEs)
    if (zScoreUpdates.length > 0) {
      const updateValues = zScoreUpdates
        .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`)
        .join(', ');

      const updateParams = zScoreUpdates.flatMap((u) => [
        u.metricId,
        u.timestamp,
        u.zScore,
      ]);

      await client.query(`
        UPDATE pxi_metric_samples AS pms
        SET z_score = v.z_score::double precision
        FROM (VALUES ${updateValues}) AS v(metric_id, source_timestamp, z_score)
        WHERE pms.metric_id = v.metric_id::text
          AND pms.source_timestamp = v.source_timestamp::timestamptz
      `, updateParams);
    }

    logger.info({ count: samples.length, metrics: uniqueMetrics.length }, 'Metric samples upserted with z-scores');
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
    zScore?: number;
    metadata?: Record<string, unknown>;
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
        source_timestamp as "sourceTimestamp",
        z_score as "zScore",
        metadata
      FROM pxi_metric_samples
      ORDER BY metric_id, source_timestamp DESC
    `);
    logger.info({ count: result.rows.length }, 'Fetched latest metric samples with z-scores');
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
 * Fetches PXI historical values for analytics
 *
 * @param daysBack - Number of days of history to fetch (default: 90)
 * @returns Array of PXI values ordered by timestamp ascending
 */
export const getPXIHistory = async (daysBack = 90): Promise<
  Array<{
    timestamp: string;
    pxiValue: number;
  }>
> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT timestamp, pxi_value as "pxiValue"
       FROM composite_pxi_regime
       WHERE timestamp >= NOW() - INTERVAL '${daysBack} days'
       ORDER BY timestamp ASC`,
    );
    logger.info({ count: result.rows.length, daysBack }, 'Fetched PXI history');
    return result.rows;
  } catch (error) {
    logger.error({ error, daysBack }, 'Failed to fetch PXI history');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Insert daily BTC technical indicators into cache
 *
 * @param data - Technical indicator data to cache
 * @returns Promise that resolves when insert completes
 */
export const insertDailyIndicators = async (data: {
  date: string;
  rsi: number | null;
  macd: { value: number; signal: number; histogram: number } | null;
  signalMultiplier: number;
}): Promise<void> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query(
      `INSERT INTO btc_daily_indicators
        (date, rsi, macd_value, macd_signal, macd_histogram, signal_multiplier)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (date)
      DO UPDATE SET
        rsi = EXCLUDED.rsi,
        macd_value = EXCLUDED.macd_value,
        macd_signal = EXCLUDED.macd_signal,
        macd_histogram = EXCLUDED.macd_histogram,
        signal_multiplier = EXCLUDED.signal_multiplier,
        updated_at = NOW()`,
      [
        data.date,
        data.rsi,
        data.macd?.value ?? null,
        data.macd?.signal ?? null,
        data.macd?.histogram ?? null,
        data.signalMultiplier,
      ],
    );
    logger.info(
      {
        date: data.date,
        rsi: data.rsi,
        signalMultiplier: data.signalMultiplier,
      },
      'Daily indicators inserted successfully',
    );
  } catch (error) {
    logger.error({ error, date: data.date }, 'Failed to insert daily indicators');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetch latest cached BTC technical indicators
 *
 * @returns Latest indicator data or null if no cache exists
 */
export const fetchLatestIndicators = async (): Promise<{
  date: string;
  rsi: number | null;
  macdValue: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  signalMultiplier: number;
  createdAt: string;
  updatedAt: string;
} | null> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query(
      `SELECT
        date,
        rsi,
        macd_value as "macdValue",
        macd_signal as "macdSignal",
        macd_histogram as "macdHistogram",
        signal_multiplier as "signalMultiplier",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM btc_daily_indicators
      ORDER BY date DESC
      LIMIT 1`,
    );

    if (result.rows.length === 0) {
      logger.warn('No cached indicators found in database');
      return null;
    }

    const cached = result.rows[0];
    logger.debug(
      {
        date: cached.date,
        age_hours: ((Date.now() - new Date(cached.updatedAt).getTime()) / (1000 * 60 * 60)).toFixed(1),
      },
      'Fetched cached indicators',
    );

    return cached;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch latest indicators');
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Fetches historical metric values for delta calculations
 * Returns the metric values from N days ago
 *
 * @param metricId - The metric ID to fetch
 * @param daysAgo - Number of days to look back
 * @returns The metric value from daysAgo, or null if not found
 */
export const fetchHistoricalMetricValue = async (
  metricId: string,
  daysAgo: number
): Promise<number | null> => {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();

    // Query for the closest sample to the target date (within ±2 days for tolerance)
    const result = await client.query(
      `SELECT value
       FROM pxi_metric_samples
       WHERE metric_id = $1
         AND source_timestamp >= NOW() - INTERVAL '${daysAgo + 2} days'
         AND source_timestamp <= NOW() - INTERVAL '${daysAgo - 2} days'
       ORDER BY ABS(EXTRACT(EPOCH FROM (source_timestamp - (NOW() - INTERVAL '${daysAgo} days'))))
       LIMIT 1`,
      [metricId]
    );

    if (result.rows.length === 0) {
      logger.debug({ metricId, daysAgo }, 'No historical value found for metric');
      return null;
    }

    return result.rows[0].value;
  } catch (error) {
    logger.error({ error, metricId, daysAgo }, 'Failed to fetch historical metric value');
    return null; // Return null on error to avoid breaking the response
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
