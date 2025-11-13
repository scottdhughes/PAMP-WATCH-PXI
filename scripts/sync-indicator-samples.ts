import { pool } from '../db.js';
import { logger } from '../logger.js';

async function syncIndicatorSamples() {
  const client = await pool.connect();
  try {
    logger.info('Syncing indicator_samples from history_values for u3...');

    // Copy the most recent 90 days of history_values for u3 into pxi_metric_samples
    const result = await client.query(`
      INSERT INTO pxi_metric_samples (
        metric_id,
        metric_label,
        value,
        unit,
        source_timestamp,
        ingested_at,
        metadata
      )
      SELECT
        indicator_id as metric_id,
        'U-3 Unemployment' as metric_label,
        raw_value as value,
        'ratio' as unit,
        date::timestamptz as source_timestamp,
        NOW() as ingested_at,
        jsonb_build_object('source', 'backfill_sync', 'original_metadata', metadata) as metadata
      FROM history_values
      WHERE indicator_id = 'u3'
        AND date >= CURRENT_DATE - INTERVAL '90 days'
      ON CONFLICT (metric_id, source_timestamp)
      DO UPDATE SET
        value = EXCLUDED.value,
        metric_label = EXCLUDED.metric_label,
        unit = EXCLUDED.unit,
        metadata = EXCLUDED.metadata
      RETURNING metric_id, source_timestamp
    `);

    logger.info(`✅ Synced ${result.rowCount} samples for u3`);

    // Refresh materialized view
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stats');
    logger.info('✅ Refreshed latest_stats materialized view');

  } catch (error) {
    logger.error({ error }, '❌ Failed to sync indicator samples');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

syncIndicatorSamples();
