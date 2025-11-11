-- Populate Historical Composite PXI with Forward-Fill
-- This computes composite PXI for the last 30 days using forward-fill for missing metrics

-- Step 1: Create a series of all dates we want to fill
WITH date_series AS (
  SELECT generate_series(
    CURRENT_DATE - INTERVAL '30 days',
    CURRENT_DATE,
    '1 day'::interval
  )::date as date
),
-- Step 2: Get the most recent value for each indicator on or before each date (forward fill)
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
  HAVING STDDEV(hv.raw_value) IS NOT NULL  -- Ensure we have enough data for stddev
),
-- Step 4: Pivot the metrics by date
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
-- Step 5: Calculate z-scores for each metric
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
-- Step 6: Calculate composite PXI (sum of z-scores)
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
-- Step 7: Insert into composite_pxi_regime table
INSERT INTO composite_pxi_regime (timestamp, pxi_value, pxi_z_score, regime, total_weight, pamp_count, stress_count, metadata)
SELECT
  (date || ' 12:00:00')::timestamp as timestamp,
  pxi_value,
  pxi_value / SQRT(7.0) as pxi_z_score,
  regime,
  7.0 as total_weight,
  0 as pamp_count,
  0 as stress_count,
  '{"source": "historical_backfill", "method": "forward_fill"}'::jsonb as metadata
FROM composite_pxi
ON CONFLICT (timestamp) DO UPDATE
SET
  pxi_value = EXCLUDED.pxi_value,
  pxi_z_score = EXCLUDED.pxi_z_score,
  regime = EXCLUDED.regime,
  total_weight = EXCLUDED.total_weight,
  metadata = EXCLUDED.metadata;

-- Return summary
SELECT
  COUNT(*) as records_inserted,
  MIN(timestamp)::date as earliest_date,
  MAX(timestamp)::date as latest_date,
  MIN(pxi_value) as min_pxi,
  MAX(pxi_value) as max_pxi
FROM composite_pxi_regime
WHERE timestamp >= (CURRENT_DATE - INTERVAL '30 days')::timestamp
  AND (metadata->>'source' = 'historical_backfill' OR metadata = '{}'::jsonb);
