-- Populate Historical Composite PXI with Normalized Weights (Matching Live Computation)
-- This computes composite PXI for the last 30 days using the exact same algorithm as compute-worker.ts
--
-- Algorithm:
-- 1. Calculate z-scores: (value - rolling_mean) / rolling_stddev
-- 2. Apply dynamic weight multipliers: α=1.5 for |z|>1.0, β=2.0 for |z|>2.0
-- 3. Calculate actual_weight = base_weight × multiplier
-- 4. Normalize weights: normalized_weight = actual_weight / total_weight (sum = 1.0)
-- 5. Calculate contributions: contribution = normalized_weight × z_score × direction
-- 6. Sum contributions to get composite PXI
-- 7. Clamp to realistic range (±3σ)

-- Step 1: Create a series of all dates we want to fill (last 30 days, excluding today)
WITH date_series AS (
  SELECT generate_series(
    CURRENT_DATE - INTERVAL '30 days',
    CURRENT_DATE - INTERVAL '1 day',  -- Exclude today - that comes from live scheduler
    '1 day'::interval
  )::date as date
),

-- Step 2: Forward-fill metrics (most recent value on or before each date)
forward_filled_metrics AS (
  SELECT DISTINCT ON (ds.date, hv.indicator_id)
    ds.date,
    hv.indicator_id,
    hv.raw_value
  FROM date_series ds
  CROSS JOIN (SELECT DISTINCT indicator_id FROM history_values
              WHERE indicator_id IN ('hyOas', 'igOas', 'vix', 'u3', 'usd', 'nfci', 'btcReturn')) indicators
  LEFT JOIN LATERAL (
    SELECT indicator_id, raw_value, date
    FROM history_values hv2
    WHERE hv2.indicator_id = indicators.indicator_id
      AND hv2.date <= ds.date
    ORDER BY hv2.date DESC
    LIMIT 1
  ) hv ON true
  WHERE hv.raw_value IS NOT NULL
  ORDER BY ds.date, hv.indicator_id, hv.date DESC
),

-- Step 3: Calculate rolling statistics (365-day window)
metric_stats AS (
  SELECT
    ffm.date,
    ffm.indicator_id,
    ffm.raw_value,
    AVG(hv.raw_value) as mean_value,
    STDDEV(hv.raw_value) as stddev_value
  FROM forward_filled_metrics ffm
  LEFT JOIN history_values hv ON (
    hv.indicator_id = ffm.indicator_id
    AND hv.date <= ffm.date
    AND hv.date >= ffm.date - INTERVAL '365 days'
  )
  GROUP BY ffm.date, ffm.indicator_id, ffm.raw_value
  HAVING STDDEV(hv.raw_value) IS NOT NULL AND STDDEV(hv.raw_value) > 0
),

-- Step 4: Calculate z-scores and apply dynamic weight multipliers
z_scores_and_weights AS (
  SELECT
    date,
    indicator_id,
    raw_value,
    mean_value,
    stddev_value,
    (raw_value - mean_value) / stddev_value as z_score,
    CASE indicator_id
      WHEN 'hyOas' THEN 1.5
      WHEN 'igOas' THEN 1.2
      WHEN 'vix' THEN 1.8
      WHEN 'u3' THEN 1.0
      WHEN 'usd' THEN 0.8
      WHEN 'nfci' THEN 1.3
      WHEN 'btcReturn' THEN 1.0
    END as base_weight,
    CASE indicator_id
      WHEN 'hyOas' THEN -1  -- higher_is_more_risk
      WHEN 'igOas' THEN -1
      WHEN 'vix' THEN -1
      WHEN 'u3' THEN -1
      WHEN 'usd' THEN 1     -- higher_is_less_risk
      WHEN 'nfci' THEN -1
      WHEN 'btcReturn' THEN 1
    END as direction
  FROM metric_stats
),

-- Step 5: Apply dynamic weight multipliers based on |z|
weighted_metrics AS (
  SELECT
    date,
    indicator_id,
    raw_value,
    mean_value,
    stddev_value,
    z_score,
    base_weight,
    direction,
    -- Dynamic weight multiplier: β=2.0 for |z|>2.0, α=1.5 for |z|>1.0, else 1.0
    CASE
      WHEN ABS(z_score) > 2.0 THEN 2.0
      WHEN ABS(z_score) > 1.0 THEN 1.5
      ELSE 1.0
    END as weight_multiplier,
    -- Actual weight = base_weight × multiplier
    base_weight * CASE
      WHEN ABS(z_score) > 2.0 THEN 2.0
      WHEN ABS(z_score) > 1.0 THEN 1.5
      ELSE 1.0
    END as actual_weight
  FROM z_scores_and_weights
),

-- Step 6: Calculate total weight per day for normalization
daily_totals AS (
  SELECT
    date,
    SUM(actual_weight) as total_weight
  FROM weighted_metrics
  GROUP BY date
),

-- Step 7: Normalize weights and calculate contributions
normalized_contributions AS (
  SELECT
    wm.date,
    wm.indicator_id,
    wm.raw_value,
    wm.z_score,
    wm.base_weight,
    wm.weight_multiplier,
    wm.actual_weight,
    dt.total_weight,
    -- Normalized weight (sum = 1.0)
    wm.actual_weight / dt.total_weight as normalized_weight,
    -- Contribution = normalized_weight × z_score × direction
    (wm.actual_weight / dt.total_weight) * wm.z_score * wm.direction as contribution
  FROM weighted_metrics wm
  JOIN daily_totals dt ON wm.date = dt.date
),

-- Step 8: Pivot metrics for easier viewing (optional, for debugging)
daily_metrics_pivot AS (
  SELECT
    date,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN z_score END) as hyOas_z,
    MAX(CASE WHEN indicator_id = 'igOas' THEN z_score END) as igOas_z,
    MAX(CASE WHEN indicator_id = 'vix' THEN z_score END) as vix_z,
    MAX(CASE WHEN indicator_id = 'u3' THEN z_score END) as u3_z,
    MAX(CASE WHEN indicator_id = 'usd' THEN z_score END) as usd_z,
    MAX(CASE WHEN indicator_id = 'nfci' THEN z_score END) as nfci_z,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN z_score END) as btc_z,
    MAX(total_weight) as total_weight
  FROM normalized_contributions
  GROUP BY date
  HAVING COUNT(DISTINCT indicator_id) = 7  -- Ensure all 7 metrics present
),

-- Step 9: Calculate composite PXI (sum of contributions)
composite_pxi AS (
  SELECT
    nc.date,
    SUM(nc.contribution) as pxi_value_raw,
    -- Clamp to realistic range (±3σ)
    CASE
      WHEN SUM(nc.contribution) > 3 THEN 3
      WHEN SUM(nc.contribution) < -3 THEN -3
      ELSE ROUND(SUM(nc.contribution)::numeric, 3)
    END as pxi_value,
    MAX(nc.total_weight) as total_weight,
    COUNT(*) FILTER (WHERE nc.z_score > 2) as pamp_count,
    COUNT(*) FILTER (WHERE nc.z_score < -2) as stress_count
  FROM normalized_contributions nc
  GROUP BY nc.date
  HAVING COUNT(DISTINCT nc.indicator_id) = 7  -- Ensure all 7 metrics present
),

-- Step 10: Classify regime
composite_with_regime AS (
  SELECT
    date,
    pxi_value,
    total_weight,
    pamp_count,
    stress_count,
    CASE
      WHEN pxi_value > 2.0 THEN 'Strong PAMP'
      WHEN pxi_value > 1.0 THEN 'Moderate PAMP'
      WHEN pxi_value >= -1.0 THEN 'Normal'
      WHEN pxi_value >= -2.0 THEN 'Elevated Stress'
      ELSE 'Crisis'
    END as regime
  FROM composite_pxi
)

-- Step 11: Insert into composite_pxi_regime table
INSERT INTO composite_pxi_regime (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count, metadata)
SELECT
  (date || ' 12:00:00')::timestamp as timestamp,
  pxi_value,
  pxi_value as pxi_z_score,  -- PXI itself is already a weighted sum of z-scores
  regime,
  total_weight,
  pamp_count,
  stress_count,
  jsonb_build_object(
    'source', 'historical_backfill_normalized',
    'method', 'forward_fill_with_normalized_weights',
    'algorithm', 'dynamic_weighting_α1.5_β2.0'
  ) as metadata
FROM composite_with_regime
ON CONFLICT (timestamp) DO UPDATE
SET
  pxi_value = EXCLUDED.pxi_value,
  pxi_z_score = EXCLUDED.pxi_z_score,
  regime = EXCLUDED.regime,
  total_weight = EXCLUDED.total_weight,
  pamp_count = EXCLUDED.pamp_count,
  stress_count = EXCLUDED.stress_count,
  metadata = EXCLUDED.metadata;

-- Step 12: Return summary with statistics
SELECT
  COUNT(*) as records_inserted,
  MIN(timestamp)::date as earliest_date,
  MAX(timestamp)::date as latest_date,
  ROUND(MIN(pxi_value)::numeric, 3) as min_pxi,
  ROUND(MAX(pxi_value)::numeric, 3) as max_pxi,
  ROUND(AVG(pxi_value)::numeric, 3) as avg_pxi,
  ROUND(STDDEV(pxi_value)::numeric, 3) as stddev_pxi,
  STRING_AGG(DISTINCT regime, ', ' ORDER BY regime) as regimes_observed
FROM composite_pxi_regime
WHERE timestamp >= (CURRENT_DATE - INTERVAL '30 days')::timestamp
  AND timestamp < CURRENT_DATE::timestamp  -- Exclude today
  AND metadata->>'source' = 'historical_backfill_normalized';
