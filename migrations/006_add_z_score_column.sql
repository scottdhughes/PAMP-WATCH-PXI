-- Migration 006: Add z-score column for PXI validation
-- Adds z-score column to pxi_metric_samples for Phase 1.5 validation system

-- Add z_score column to store normalized z-scores
ALTER TABLE pxi_metric_samples
ADD COLUMN IF NOT EXISTS z_score DOUBLE PRECISION;

-- Add index for efficient z-score queries
CREATE INDEX IF NOT EXISTS idx_pxi_metric_samples_z_score
  ON pxi_metric_samples(metric_id, z_score)
  WHERE z_score IS NOT NULL;

-- Comments
COMMENT ON COLUMN pxi_metric_samples.z_score IS 'Normalized z-score: (value - μ) / σ using rolling 90-day window';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON pxi_metric_samples TO pxi;
