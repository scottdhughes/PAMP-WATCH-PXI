#!/usr/bin/env tsx
/**
 * Migration runner script
 * Usage: tsx scripts/run-migration.ts <migration-file>
 */

import { pool, closePool } from '../db.js';
import { readFile } from 'fs/promises';
import { logger } from '../logger.js';

async function runMigration(migrationFile: string): Promise<void> {
  try {
    logger.info({ migrationFile }, 'Running migration');

    // Read migration SQL
    const sql = await readFile(migrationFile, 'utf-8');

    // Execute migration
    await pool.query(sql);

    logger.info({ migrationFile }, 'Migration completed successfully');
  } catch (error) {
    logger.error({ error, migrationFile }, 'Migration failed');
    throw error;
  }
}

async function main() {
  const migrationFile = process.argv[2];

  if (!migrationFile) {
    console.error('Usage: tsx scripts/run-migration.ts <migration-file>');
    process.exit(1);
  }

  try {
    await runMigration(migrationFile);
    await closePool();
    process.exit(0);
  } catch (error) {
    await closePool();
    process.exit(1);
  }
}

main();
