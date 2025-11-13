import { pool } from '../db.js';

async function refreshStats() {
  const client = await pool.connect();
  try {
    console.log('Refreshing latest_stats materialized view...');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stats');
    console.log('✅ Materialized view refreshed successfully');
  } catch (error) {
    console.error('❌ Failed to refresh materialized view:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

refreshStats();
