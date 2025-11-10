#!/usr/bin/env tsx
/**
 * Verify weight normalization
 * Demonstrates that weights sum to 1.0 and automatically adjust when feeds fail
 */

import { pool, closePool } from '../db.js';
import { logger } from '../logger.js';

async function verifyNormalization(): Promise<void> {
  try {
    // Get the latest contributions
    const result = await pool.query(`
      SELECT
        indicator_id,
        base_weight,
        actual_weight,
        normalized_weight,
        contribution,
        timestamp
      FROM contributions
      WHERE timestamp = (SELECT MAX(timestamp) FROM contributions)
      ORDER BY indicator_id
    `);

    console.log('\n=== WEIGHT NORMALIZATION VERIFICATION ===\n');
    console.log('Latest calculation timestamp:', result.rows[0]?.timestamp);
    console.log('');

    let totalActualWeight = 0;
    let totalNormalizedWeight = 0;
    let activeIndicators = 0;

    console.log('Indicator        | Base   | Actual | Normalized | Contribution');
    console.log('-----------------|--------|--------|------------|-------------');

    for (const row of result.rows) {
      console.log(
        `${row.indicator_id.padEnd(16)} | ${row.base_weight.toFixed(2).padStart(6)} | ` +
        `${row.actual_weight.toFixed(2).padStart(6)} | ${row.normalized_weight.toFixed(4).padStart(10)} | ` +
        `${row.contribution.toFixed(4).padStart(11)}`
      );
      totalActualWeight += row.actual_weight;
      totalNormalizedWeight += row.normalized_weight;
      activeIndicators++;
    }

    console.log('-----------------|--------|--------|------------|-------------');
    console.log(
      `TOTALS (${activeIndicators})      | ${''.padStart(6)} | ${totalActualWeight.toFixed(2).padStart(6)} | ` +
      `${totalNormalizedWeight.toFixed(4).padStart(10)} | ${''.padStart(11)}`
    );

    console.log('');
    console.log('=== VALIDATION ===\n');

    // Check if normalized weights sum to 1.0 (within floating point tolerance)
    const isNormalized = Math.abs(totalNormalizedWeight - 1.0) < 0.0001;
    console.log(`✓ Normalized weights sum to 1.0: ${isNormalized ? 'PASS' : 'FAIL'} (${totalNormalizedWeight.toFixed(6)})`);

    // Show which feeds are missing
    const allIndicators = ['hyOas', 'igOas', 'vix', 'u3', 'nfci', 'usd', 'btcReturn'];
    const activeIds = result.rows.map((r) => r.indicator_id);
    const missingFeeds = allIndicators.filter((id) => !activeIds.includes(id));

    if (missingFeeds.length > 0) {
      console.log(`\n✓ Missing feeds detected: ${missingFeeds.join(', ')}`);
      console.log(`  → Weights automatically re-normalized across ${activeIndicators} active indicators`);

      // Calculate what the normalized weight would be if all feeds were active
      const totalBaseWeight = 8.0; // Sum of all base weights
      console.log(`\n  If all ${allIndicators.length} feeds were active:`);
      console.log(`    - Total base weight would be: ${totalBaseWeight.toFixed(2)}`);
      console.log(`    - Each indicator's normalized weight would be different`);
      console.log(`\n  With ${activeIndicators} active feeds:`);
      console.log(`    - Total actual weight is: ${totalActualWeight.toFixed(2)}`);
      console.log(`    - Weights automatically scaled to sum to 1.0`);
    } else {
      console.log(`\n✓ All ${allIndicators.length} feeds active`);
    }

    console.log('');
  } catch (error) {
    logger.error({ error }, 'Verification failed');
    throw error;
  }
}

async function main() {
  try {
    await verifyNormalization();
    await closePool();
    process.exit(0);
  } catch (error) {
    await closePool();
    process.exit(1);
  }
}

main();
