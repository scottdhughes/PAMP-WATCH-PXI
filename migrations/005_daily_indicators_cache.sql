-- Migration 005: Daily BTC Technical Indicators Cache
-- Stores daily RSI/MACD calculations to avoid repeated API calls
-- Reduces API calls from 1,440/day to 2/day (99.9% reduction)

-- Create the daily indicators cache table
CREATE TABLE IF NOT EXISTS btc_daily_indicators (
  date DATE PRIMARY KEY,
  rsi DOUBLE PRECISION,
  macd_value DOUBLE PRECISION,
  macd_signal DOUBLE PRECISION,
  macd_histogram DOUBLE PRECISION,
  signal_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for date lookups (most recent first)
CREATE INDEX IF NOT EXISTS idx_btc_daily_indicators_date
ON btc_daily_indicators(date DESC);

-- Index for created_at to monitor cache freshness
CREATE INDEX IF NOT EXISTS idx_btc_daily_indicators_created_at
ON btc_daily_indicators(created_at DESC);

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_btc_daily_indicators_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER btc_daily_indicators_updated_at
  BEFORE UPDATE ON btc_daily_indicators
  FOR EACH ROW
  EXECUTE FUNCTION update_btc_daily_indicators_updated_at();

-- Comments
COMMENT ON TABLE btc_daily_indicators IS 'Daily cache of BTC technical indicators (RSI, MACD) - refreshed twice daily at 00:05 and 12:05 UTC';
COMMENT ON COLUMN btc_daily_indicators.date IS 'Date of the indicator calculation (YYYY-MM-DD)';
COMMENT ON COLUMN btc_daily_indicators.rsi IS 'Relative Strength Index (0-100) - 14-day period';
COMMENT ON COLUMN btc_daily_indicators.macd_value IS 'MACD line value (12,26,9 parameters)';
COMMENT ON COLUMN btc_daily_indicators.macd_signal IS 'MACD signal line value';
COMMENT ON COLUMN btc_daily_indicators.macd_histogram IS 'MACD histogram (MACD - Signal)';
COMMENT ON COLUMN btc_daily_indicators.signal_multiplier IS 'Calculated weight multiplier (0.8-1.2 range) based on RSI and MACD';
COMMENT ON COLUMN btc_daily_indicators.created_at IS 'Timestamp when this record was first created';
COMMENT ON COLUMN btc_daily_indicators.updated_at IS 'Timestamp when this record was last updated (auto-updated on UPSERT)';
