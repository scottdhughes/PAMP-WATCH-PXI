import { Pool } from 'pg';
import { config } from './config.js';
export const pool = new Pool({ connectionString: config.postgresUrl, max: 4 });
export const upsertMetricSamples = async (samples) => {
    if (!samples.length)
        return;
    const client = await pool.connect();
    try {
        const insertText = `
      INSERT INTO pxi_metric_samples
        (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
      VALUES
        ${samples
            .map((_, idx) => `($${idx * 7 + 1}, $${idx * 7 + 2}, $${idx * 7 + 3}, $${idx * 7 + 4}, $${idx * 7 + 5}, $${idx * 7 + 6}, $${idx * 7 + 7})`)
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
    }
    finally {
        client.release();
    }
};
