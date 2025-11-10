-- Migration 002: Historical Statistics and Alert System
-- This migration adds support for:
-- 1. Historical data storage (10-year rolling window)
-- 2. Rolling statistics (mean, stddev)
-- 3. Enhanced z-score tracking
-- 4. Alert/warning system

-- Historical values table (10-year rolling window)
CREATE TABLE IF NOT EXISTS history_values (
  indicator_id   TEXT NOT NULL,
  date           DATE NOT NULL,
  raw_value      DOUBLE PRECISION NOT NULL,
  source         TEXT DEFAULT 'live_feed',
  metadata       JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (indicator_id, date)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_history_values_indicator_date
  ON history_values(indicator_id, date DESC);

-- Rolling statistics table (computed daily)
CREATE TABLE IF NOT EXISTS stats_values (
  indicator_id   TEXT NOT NULL,
  date           DATE NOT NULL,
  window_days    INTEGER NOT NULL DEFAULT 2520, -- ~10 years of trading days
  mean_value     DOUBLE PRECISION NOT NULL,
  stddev_value   DOUBLE PRECISION NOT NULL,
  min_value      DOUBLE PRECISION,
  max_value      DOUBLE PRECISION,
  sample_count   INTEGER NOT NULL,
  metadata       JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (indicator_id, date)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_stats_values_indicator_date
  ON stats_values(indicator_id, date DESC);

-- Enhanced z-scores table
CREATE TABLE IF NOT EXISTS z_scores (
  indicator_id   TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL,
  raw_value      DOUBLE PRECISION NOT NULL,
  mean_value     DOUBLE PRECISION NOT NULL,
  stddev_value   DOUBLE PRECISION NOT NULL,
  z_score        DOUBLE PRECISION NOT NULL,
  metadata       JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (indicator_id, timestamp)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_z_scores_indicator_timestamp
  ON z_scores(indicator_id, timestamp DESC);

-- Contributions table (with dynamic weights)
CREATE TABLE IF NOT EXISTS contributions (
  indicator_id   TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL,
  raw_value      DOUBLE PRECISION NOT NULL,
  z_score        DOUBLE PRECISION NOT NULL,
  base_weight    DOUBLE PRECISION NOT NULL,
  actual_weight  DOUBLE PRECISION NOT NULL,
  weight_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  contribution   DOUBLE PRECISION NOT NULL,
  metadata       JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (indicator_id, timestamp)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_contributions_indicator_timestamp
  ON contributions(indicator_id, timestamp DESC);

-- Alert system table
CREATE TABLE IF NOT EXISTS alerts (
  id             BIGSERIAL PRIMARY KEY,
  alert_type     VARCHAR(50) NOT NULL,
  indicator_id   VARCHAR(50),
  timestamp      TIMESTAMPTZ NOT NULL,
  raw_value      DOUBLE PRECISION,
  z_score        DOUBLE PRECISION,
  weight         DOUBLE PRECISION,
  contribution   DOUBLE PRECISION,
  threshold      DOUBLE PRECISION,
  message        TEXT NOT NULL,
  severity       VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  acknowledged   BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by VARCHAR(100),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  metadata       JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for alerts
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp
  ON alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity
  ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged
  ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_indicator
  ON alerts(indicator_id, timestamp DESC);

-- Composite PXI regime tracking (enhanced)
CREATE TABLE IF NOT EXISTS composite_pxi_regime (
  timestamp      TIMESTAMPTZ PRIMARY KEY,
  pxi_value      DOUBLE PRECISION NOT NULL,
  pxi_z_score    DOUBLE PRECISION NOT NULL,
  regime         VARCHAR(32) NOT NULL,
  total_weight   DOUBLE PRECISION NOT NULL,
  pamp_count     INTEGER NOT NULL DEFAULT 0,
  stress_count   INTEGER NOT NULL DEFAULT 0,
  metadata       JSONB DEFAULT '{}'::jsonb
);

-- Create index for regime tracking
CREATE INDEX IF NOT EXISTS idx_composite_pxi_regime_timestamp
  ON composite_pxi_regime(timestamp DESC);

-- Add retention policies for historical data
-- Keep 15 years of history (extra buffer beyond 10-year window)
SELECT add_retention_policy('history_values', INTERVAL '15 years', if_not_exists => TRUE);

-- Keep all stats (they're small)
-- Stats are computed summaries, so we keep them indefinitely

-- Keep z-scores for 5 years (for analysis)
SELECT add_retention_policy('z_scores', INTERVAL '5 years', if_not_exists => TRUE);

-- Keep contributions for 5 years
SELECT add_retention_policy('contributions', INTERVAL '5 years', if_not_exists => TRUE);

-- Keep alerts for 2 years
SELECT add_retention_policy('alerts', INTERVAL '2 years', if_not_exists => TRUE);

-- Keep composite regime for 5 years
SELECT add_retention_policy('composite_pxi_regime', INTERVAL '5 years', if_not_exists => TRUE);

-- Grant permissions to pxi user
GRANT SELECT, INSERT, UPDATE ON history_values TO pxi;
GRANT SELECT, INSERT, UPDATE ON stats_values TO pxi;
GRANT SELECT, INSERT, UPDATE ON z_scores TO pxi;
GRANT SELECT, INSERT, UPDATE ON contributions TO pxi;
GRANT SELECT, INSERT, UPDATE ON alerts TO pxi;
GRANT SELECT, INSERT, UPDATE ON composite_pxi_regime TO pxi;
GRANT USAGE, SELECT ON SEQUENCE alerts_id_seq TO pxi;

-- Create materialized view for latest statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS latest_stats AS
SELECT DISTINCT ON (indicator_id)
  indicator_id,
  date,
  mean_value,
  stddev_value,
  sample_count
FROM stats_values
ORDER BY indicator_id, date DESC;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_latest_stats_indicator
  ON latest_stats(indicator_id);

-- Grant access to materialized view
GRANT SELECT ON latest_stats TO pxi;

-- Add refresh policy for materialized view (refresh every hour)
CREATE OR REPLACE FUNCTION refresh_latest_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY latest_stats;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE history_values IS 'Historical raw values for all indicators (10-year rolling window)';
COMMENT ON TABLE stats_values IS 'Rolling statistics (mean, stddev) computed from historical data';
COMMENT ON TABLE z_scores IS 'Statistical z-scores calculated from rolling window statistics';
COMMENT ON TABLE contributions IS 'Weighted contributions with dynamic weight adjustments';
COMMENT ON TABLE alerts IS 'Alert and warning system for threshold breaches and anomalies';
COMMENT ON TABLE composite_pxi_regime IS 'Composite PXI values with regime classification';
