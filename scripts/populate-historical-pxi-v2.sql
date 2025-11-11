-- Populate Historical Composite PXI from history_values
-- This computes composite PXI for the last 30 days using historical metric data
-- Calculates rolling statistics (mean/stddev) on the fly

-- Step 1: Calculate statistics for each metric for each date
WITH metric_stats AS (
  SELECT
    hv.indicator_id,
    hv.date,
    hv.raw_value,
    AVG(hv2.raw_value) as mean_value,
    STDDEV(hv2.raw_value) as stddev_value
  FROM history_values hv
  CROSS JOIN LATERAL (
    -- For each date, use all historical data up to 365 days before that date to calculate stats
    SELECT raw_value
    FROM history_values hv2
    WHERE hv2.indicator_id = hv.indicator_id
      AND hv2.date <= hv.date
      AND hv2.date >= hv.date - INTERVAL '365 days'
  ) hv2
  WHERE hv.date >= CURRENT_DATE - INTERVAL '30 days'
    AND hv.indicator_id IN ('hyOas', 'igOas', 'vix', 'u3', 'usd', 'nfci', 'btcReturn')
  GROUP BY hv.indicator_id, hv.date, hv.raw_value
),
-- Step 2: Pivot the metrics by date
daily_metrics AS (
  SELECT
    date,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN raw_value END) as hyOas_value,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN mean_value END) as hyOas_mean,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN stddev_value END) as hyOas_stddev,
    MAX(CASE WHEN indicator_id = 'igOas' THEN raw_value END) as igOas_value,
    MAX(CASE WHEN indicator_id = 'igOas' THEN mean_value END) as igOas_mean,
    MAX(CASE WHEN indicator_id = 'igOas' THEN stddev_value END) as igOas_stddev,
    MAX(CASE WHEN indicator_id = 'vix' THEN raw_value END) as vix_value,
    MAX(CASE WHEN indicator_id = 'vix' THEN mean_value END) as vix_mean,
    MAX(CASE WHEN indicator_id = 'vix' THEN stddev_value END) as vix_stddev,
    MAX(CASE WHEN indicator_id = 'u3' THEN raw_value END) as u3_value,
    MAX(CASE WHEN indicator_id = 'u3' THEN mean_value END) as u3_mean,
    MAX(CASE WHEN indicator_id = 'u3' THEN stddev_value END) as u3_stddev,
    MAX(CASE WHEN indicator_id = 'usd' THEN raw_value END) as usd_value,
    MAX(CASE WHEN indicator_id = 'usd' THEN mean_value END) as usd_mean,
    MAX(CASE WHEN indicator_id = 'usd' THEN stddev_value END) as usd_stddev,
    MAX(CASE WHEN indicator_id = 'nfci' THEN raw_value END) as nfci_value,
    MAX(CASE WHEN indicator_id = 'nfci' THEN mean_value END) as nfci_mean,
    MAX(CASE WHEN indicator_id = 'nfci' THEN stddev_value END) as nfci_stddev,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN raw_value END) as btc_value,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN mean_value END) as btc_mean,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN stddev_value END) as btc_stddev
  FROM metric_stats
  GROUP BY date
),
-- Step 3: Calculate z-scores for each metric
z_scores AS (
  SELECT
    date,
    CASE
      WHEN hyOas_stddev > 0 THEN (hyOas_value - hyOas_mean) / hyOas_stddev
      ELSE 0
    END as hyOas_z,
    CASE
      WHEN igOas_stddev > 0 THEN (igOas_value - igOas_mean) / igOas_stddev
      ELSE 0
    END as igOas_z,
    CASE
      WHEN vix_stddev > 0 THEN (vix_value - vix_mean) / vix_stddev
      ELSE 0
    END as vix_z,
    CASE
      WHEN u3_stddev > 0 THEN (u3_value - u3_mean) / u3_stddev
      ELSE 0
    END as u3_z,
    CASE
      WHEN usd_stddev > 0 THEN (usd_value - usd_mean) / usd_stddev
      ELSE 0
    END as usd_z,
    CASE
      WHEN nfci_stddev > 0 THEN (nfci_value - nfci_mean) / nfci_stddev
      ELSE 0
    END as nfci_z,
    CASE
      WHEN btc_stddev > 0 THEN (btc_value - btc_mean) / btc_stddev
      ELSE 0
    END as btc_z
  FROM daily_metrics
  WHERE hyOas_value IS NOT NULL
    AND igOas_value IS NOT NULL
    AND vix_value IS NOT NULL
    AND u3_value IS NOT NULL
    AND usd_value IS NOT NULL
    AND nfci_value IS NOT NULL
    AND btc_value IS NOT NULL
),
-- Step 4: Calculate composite PXI (sum of z-scores)
composite_pxi AS (
  SELECT
    date,
    (hyOas_z + igOas_z + vix_z + u3_z + usd_z + nfci_z + btc_z) as pxi_value,
    CASE
      WHEN ABS(hyOas_z + igOas_z + vix_z + u3_z + usd_z + nfci_z + btc_z) > 4 THEN 'Strong PAMP'
      WHEN ABS(hyOas_z + igOas_z + vix_z + u3_z + usd_z + nfci_z + btc_z) > 3 THEN 'Crisis'
      WHEN ABS(hyOas_z + igOas_z + vix_z + u3_z + usd_z + nfci_z + btc_z) > 2 THEN 'Stress'
      WHEN ABS(hyOas_z + igOas_z + vix_z + u3_z + usd_z + nfci_z + btc_z) > 1 THEN 'Caution'
      ELSE 'Stable'
    END as regime
  FROM z_scores
)
-- Step 5: Insert into composite_pxi_regime table
INSERT INTO composite_pxi_regime (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count, metadata)
SELECT
  (date || ' 12:00:00')::timestamp as timestamp,
  pxi_value,
  pxi_value / SQRT(7.0) as pxi_z_score, -- Approximate z-score of the composite
  regime,
  7.0 as total_weight,
  0 as pamp_count,
  0 as stress_count,
  '{"source": "historical_backfill"}'::jsonb as metadata
FROM composite_pxi
ON CONFLICT (timestamp) DO UPDATE
SET
  pxi_value = EXCLUDED.pxi_value,
  pxi_z_score = EXCLUDED.pxi_z_score,
  regime = EXCLUDED.regime,
  total_weight = EXCLUDED.total_weight;

-- Return summary
SELECT
  COUNT(*) as records_inserted,
  MIN(timestamp)::date as earliest_date,
  MAX(timestamp)::date as latest_date,
  MIN(pxi_value) as min_pxi,
  MAX(pxi_value) as max_pxi
FROM composite_pxi_regime
WHERE timestamp >= (CURRENT_DATE - INTERVAL '30 days')::timestamp;
