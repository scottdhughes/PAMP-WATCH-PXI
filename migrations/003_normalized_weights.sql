-- Migration 003: Add normalized_weight column to contributions table
--
-- This migration adds support for weight normalization after feed loss.
-- The normalized_weight ensures that all active weights sum to 1.0 (or 100%),
-- automatically re-distributing weight when feeds fail.

-- Add normalized_weight column to contributions table
ALTER TABLE contributions
ADD COLUMN IF NOT EXISTS normalized_weight DOUBLE PRECISION;

-- Backfill normalized_weight for existing records
-- For historical data, we'll set normalized_weight = actual_weight / total_weight
-- where total_weight is the sum of actual_weight for all indicators at that timestamp
WITH weight_totals AS (
  SELECT
    timestamp,
    SUM(actual_weight) as total_weight
  FROM contributions
  GROUP BY timestamp
)
UPDATE contributions c
SET normalized_weight = c.actual_weight / wt.total_weight
FROM weight_totals wt
WHERE c.timestamp = wt.timestamp
  AND c.normalized_weight IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN contributions.normalized_weight IS
  'Weight normalized to sum to 1.0 across all active indicators at this timestamp. Ensures automatic weight re-distribution when feeds fail.';

-- Create index for analytics queries that filter by normalized weight
CREATE INDEX IF NOT EXISTS idx_contributions_normalized_weight
  ON contributions(timestamp DESC, normalized_weight DESC);
