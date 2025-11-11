-- Populate Historical Composite PXI from history_values
-- This computes composite PXI for the last 30 days using historical metric data

-- Step 1: Create a temporary table with all metrics pivoted by date
WITH daily_metrics AS (
  SELECT
    date,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN raw_value END) as hyOas_value,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN mean END) as hyOas_mean,
    MAX(CASE WHEN indicator_id = 'hyOas' THEN stddev END) as hyOas_stddev,
    MAX(CASE WHEN indicator_id = 'igOas' THEN raw_value END) as igOas_value,
    MAX(CASE WHEN indicator_id = 'igOas' THEN mean END) as igOas_mean,
    MAX(CASE WHEN indicator_id = 'igOas' THEN stddev END) as igOas_stddev,
    MAX(CASE WHEN indicator_id = 'vix' THEN raw_value END) as vix_value,
    MAX(CASE WHEN indicator_id = 'vix' THEN mean END) as vix_mean,
    MAX(CASE WHEN indicator_id = 'vix' THEN stddev END) as vix_stddev,
    MAX(CASE WHEN indicator_id = 'u3' THEN raw_value END) as u3_value,
    MAX(CASE WHEN indicator_id = 'u3' THEN mean END) as u3_mean,
    MAX(CASE WHEN indicator_id = 'u3' THEN stddev END) as u3_stddev,
    MAX(CASE WHEN indicator_id = 'usd' THEN raw_value END) as usd_value,
    MAX(CASE WHEN indicator_id = 'usd' THEN mean END) as usd_mean,
    MAX(CASE WHEN indicator_id = 'usd' THEN stddev END) as usd_stddev,
    MAX(CASE WHEN indicator_id = 'nfci' THEN raw_value END) as nfci_value,
    MAX(CASE WHEN indicator_id = 'nfci' THEN mean END) as nfci_mean,
    MAX(CASE WHEN indicator_id = 'nfci' THEN stddev END) as nfci_stddev,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN raw_value END) as btc_value,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN mean END) as btc_mean,
    MAX(CASE WHEN indicator_id = 'btcReturn' THEN stddev END) as btc_stddev
  FROM history_values
  WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    AND indicator_id IN ('hyOas', 'igOas', 'vix', 'u3', 'usd', 'nfci', 'btcReturn')
  GROUP BY date
),
-- Step 2: Calculate z-scores for each metric
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
-- Step 3: Calculate composite PXI (sum of z-scores)
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
-- Step 4: Insert into composite_pxi_regime table
INSERT INTO composite_pxi_regime (timestamp, pxi_value, regime, weight_sum, thresholds)
SELECT
  (date || ' 12:00:00')::timestamp as timestamp,
  pxi_value,
  regime,
  7.0 as weight_sum,
  '{"stable": 1, "caution": 2, "stress": 3, "crisis": 4}'::jsonb as thresholds
FROM composite_pxi
ON CONFLICT (timestamp) DO UPDATE
SET
  pxi_value = EXCLUDED.pxi_value,
  regime = EXCLUDED.regime,
  weight_sum = EXCLUDED.weight_sum;

-- Return summary
SELECT
  COUNT(*) as records_inserted,
  MIN(timestamp)::date as earliest_date,
  MAX(timestamp)::date as latest_date,
  MIN(pxi_value) as min_pxi,
  MAX(pxi_value) as max_pxi
FROM composite_pxi_regime
WHERE timestamp >= (CURRENT_DATE - INTERVAL '30 days')::timestamp;
