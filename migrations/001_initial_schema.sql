-- Initial PXI Database Schema
-- This migration creates the core tables and indexes for the PXI platform

-- Enable TimescaleDB extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Metric samples table
CREATE TABLE IF NOT EXISTS pxi_metric_samples (
  metric_id TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (metric_id, source_timestamp)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('pxi_metric_samples', 'source_timestamp',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_metric_samples_metric_id
  ON pxi_metric_samples(metric_id, source_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_metric_samples_ingested_at
  ON pxi_metric_samples(ingested_at DESC);

-- Add retention policy (keep 90 days)
SELECT add_retention_policy('pxi_metric_samples', INTERVAL '90 days', if_not_exists => TRUE);

-- PXI composites table
CREATE TABLE IF NOT EXISTS pxi_composites (
  id BIGSERIAL PRIMARY KEY,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  z_score DOUBLE PRECISION NOT NULL,
  pxi DOUBLE PRECISION NOT NULL,
  metrics JSONB NOT NULL,
  breaches JSONB NOT NULL,
  CONSTRAINT pxi_composites_calculated_at_unique UNIQUE (calculated_at)
);

-- Indexes for composites
CREATE INDEX IF NOT EXISTS idx_pxi_composites_calculated_at
  ON pxi_composites(calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pxi_composites_pxi
  ON pxi_composites(pxi);

-- Add retention policy for composites (keep 1 year)
SELECT add_retention_policy('pxi_composites', INTERVAL '1 year', if_not_exists => TRUE);

-- Create continuous aggregate for hourly rollups (optional, for analytics)
CREATE MATERIALIZED VIEW IF NOT EXISTS pxi_hourly_metrics
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', source_timestamp) AS bucket,
  metric_id,
  metric_label,
  AVG(value) as avg_value,
  MIN(value) as min_value,
  MAX(value) as max_value,
  COUNT(*) as sample_count
FROM pxi_metric_samples
GROUP BY bucket, metric_id, metric_label
WITH NO DATA;

-- Add continuous aggregate policy
SELECT add_continuous_aggregate_policy('pxi_hourly_metrics',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- Grant permissions (adjust user as needed)
GRANT SELECT, INSERT, UPDATE ON pxi_metric_samples TO pxi;
GRANT SELECT, INSERT ON pxi_composites TO pxi;
GRANT USAGE, SELECT ON SEQUENCE pxi_composites_id_seq TO pxi;
