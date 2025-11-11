-- Migration 004: Add Technical Indicators (RSI, MACD) to Metric Samples
-- Adds support for technical indicator tracking on BTC and other metrics

-- Add RSI column to pxi_metric_samples
ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS rsi DOUBLE PRECISION;

-- Add MACD columns to pxi_metric_samples
ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS macd_value DOUBLE PRECISION;

ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS macd_signal DOUBLE PRECISION;

ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS macd_histogram DOUBLE PRECISION;

-- Add signal multiplier column (for tracking RSI/MACD-based weight adjustments)
ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS signal_multiplier DOUBLE PRECISION DEFAULT 1.0;

-- Add indexes for performance on technical indicator queries
CREATE INDEX IF NOT EXISTS idx_pxi_metric_samples_rsi
ON pxi_metric_samples(metric_id, rsi)
WHERE rsi IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pxi_metric_samples_macd
ON pxi_metric_samples(metric_id, macd_value)
WHERE macd_value IS NOT NULL;

-- Add comments
COMMENT ON COLUMN pxi_metric_samples.rsi IS 'Relative Strength Index (0-100)';
COMMENT ON COLUMN pxi_metric_samples.macd_value IS 'MACD line value';
COMMENT ON COLUMN pxi_metric_samples.macd_signal IS 'MACD signal line value';
COMMENT ON COLUMN pxi_metric_samples.macd_histogram IS 'MACD histogram (MACD - Signal)';
COMMENT ON COLUMN pxi_metric_samples.signal_multiplier IS 'Weight multiplier based on technical indicators (default: 1.0)';
