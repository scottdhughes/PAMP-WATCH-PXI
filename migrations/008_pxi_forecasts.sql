-- Migration 008: PXI Statistical Forecasting
-- Add table for storing regime forecasts

-- Forecasts table
CREATE TABLE IF NOT EXISTS pxi_forecasts (
  id                SERIAL PRIMARY KEY,
  created_at        TIMESTAMP DEFAULT NOW(),
  forecast_date     DATE NOT NULL,           -- Date of the forecast
  horizon_days      INTEGER NOT NULL,        -- Days ahead (1-7)
  predicted_pxi     NUMERIC(10,4) NOT NULL,  -- Forecasted PXI value
  predicted_regime  VARCHAR(32) NOT NULL,    -- Forecasted regime
  confidence        NUMERIC(5,4),            -- Confidence probability (0-1)
  ci_lower          NUMERIC(10,4),           -- Lower confidence interval
  ci_upper          NUMERIC(10,4),           -- Upper confidence interval
  method            VARCHAR(32) DEFAULT 'statistical', -- 'statistical', 'lstm', etc.

  UNIQUE(created_at, horizon_days)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pxi_forecasts_created
  ON pxi_forecasts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pxi_forecasts_date
  ON pxi_forecasts(forecast_date DESC);

CREATE INDEX IF NOT EXISTS idx_pxi_forecasts_method
  ON pxi_forecasts(method);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON pxi_forecasts TO pxi;
GRANT USAGE, SELECT ON SEQUENCE pxi_forecasts_id_seq TO pxi;

-- Comments
COMMENT ON TABLE pxi_forecasts IS 'Statistical regime forecasts (exponential smoothing + linear regression)';
COMMENT ON COLUMN pxi_forecasts.horizon_days IS 'Days ahead from created_at (1-7)';
COMMENT ON COLUMN pxi_forecasts.predicted_pxi IS 'Forecasted PXI value';
COMMENT ON COLUMN pxi_forecasts.predicted_regime IS 'Forecasted regime (Crisis, Elevated Stress, Normal, Moderate PAMP, Strong PAMP)';
COMMENT ON COLUMN pxi_forecasts.confidence IS 'Forecast confidence based on CI width (0.5-1.0)';
COMMENT ON COLUMN pxi_forecasts.method IS 'Forecasting method used (statistical, lstm, arima, etc.)';
