-- Migration 007: PXI K-Means Regime Detection
-- Add table for storing k-means clustering results

-- Regime detection results table
CREATE TABLE IF NOT EXISTS pxi_regimes (
  id             SERIAL PRIMARY KEY,
  date           DATE NOT NULL UNIQUE,
  regime         VARCHAR(32) NOT NULL,  -- 'Calm', 'Normal', 'Stress'
  cluster_id     INTEGER NOT NULL,      -- 0, 1, 2
  features       JSONB NOT NULL,        -- Feature vector used for clustering
  centroid       JSONB,                 -- Cluster centroid
  probabilities  JSONB,                 -- Distance to each cluster
  created_at     TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pxi_regimes_date
  ON pxi_regimes(date DESC);

CREATE INDEX IF NOT EXISTS idx_pxi_regimes_regime
  ON pxi_regimes(regime);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON pxi_regimes TO pxi;
GRANT USAGE, SELECT ON SEQUENCE pxi_regimes_id_seq TO pxi;

-- Comments
COMMENT ON TABLE pxi_regimes IS 'K-means clustering regime detection (k=3, seeded)';
COMMENT ON COLUMN pxi_regimes.regime IS 'Human-readable regime label';
COMMENT ON COLUMN pxi_regimes.cluster_id IS 'Cluster ID (0=Calm, 1=Normal, 2=Stress)';
COMMENT ON COLUMN pxi_regimes.features IS 'Feature vector: z-scores and volatilities';
COMMENT ON COLUMN pxi_regimes.centroid IS 'Cluster centroid coordinates';
COMMENT ON COLUMN pxi_regimes.probabilities IS 'Distances to each cluster center';
