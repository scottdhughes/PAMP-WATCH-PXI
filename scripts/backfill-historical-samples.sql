/**
 * Backfill Historical Metric Samples
 *
 * Generates 35 days of synthetic historical data for testing delta calculations.
 * Uses realistic trends and cadences for each metric type.
 *
 * Run: psql postgresql://pxi:pxi123@localhost:5432/pxi -f scripts/backfill-historical-samples.sql
 */

BEGIN;

-- 1. HY OAS (High Yield OAS) - Daily updates
-- Current: 0.0315 (3.15%), trend: slightly declining
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'hyOas',
  'HY OAS',
  -- Start at 3.25% and trend down to 3.15% with daily volatility
  0.0325 - (seq * 0.0003) + (random() * 0.0008 - 0.0004),
  'value',
  (NOW() - ((35 - seq) || ' days')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "BAMLH0A0HYM2", "backfilled": true}'::jsonb
FROM generate_series(0, 34) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 2. IG OAS (Investment Grade OAS) - Daily updates
-- Current: 0.0106 (1.06%), trend: stable with slight decline
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'igOas',
  'IG OAS',
  -- Start at 1.12% and trend down to 1.06% with daily volatility
  0.0112 - (seq * 0.00018) + (random() * 0.0003 - 0.00015),
  'value',
  (NOW() - ((35 - seq) || ' days')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "BAMLC0A4CBBB", "backfilled": true}'::jsonb
FROM generate_series(0, 34) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 3. VIX Index - Daily updates
-- Current: 17.6, trend: declining from higher volatility
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'vix',
  'VIX Index',
  -- Start at 22.5 and trend down to 17.6 with daily volatility
  22.5 - (seq * 0.14) + (random() * 2.5 - 1.25),
  'value',
  (NOW() - ((35 - seq) || ' days')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "VIXCLS", "backfilled": true}'::jsonb
FROM generate_series(0, 34) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 4. USD Index (Broad) - Daily updates
-- Current: 121.7835, trend: strengthening
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'usd',
  'USD Index (Broad)',
  -- Start at 119.5 and trend up to 121.78 with daily volatility
  119.5 + (seq * 0.065) + (random() * 0.8 - 0.4),
  'value',
  (NOW() - ((35 - seq) || ' days')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "DTWEXBGS", "backfilled": true}'::jsonb
FROM generate_series(0, 34) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 5. NFCI (Chicago Fed National Financial Conditions Index) - Weekly updates (Fridays)
-- Current: -0.51456, trend: easing (becoming more negative = looser conditions)
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'nfci',
  'Chicago Fed NFCI',
  -- Start at -0.35 and trend down to -0.51 weekly
  -0.35 - (seq * 0.032) + (random() * 0.08 - 0.04),
  'value',
  (NOW() - ((5 - seq) || ' weeks')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "NFCI", "backfilled": true}'::jsonb
FROM generate_series(0, 5) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 6. U-3 Unemployment Rate - Monthly updates (first Friday of month)
-- Current: 0.043 (4.3%), trend: stable with slight decline
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'u3',
  'U-3 Unemployment',
  -- Start at 4.5% and trend down to 4.3% monthly
  0.045 - (seq * 0.0004) + (random() * 0.0003 - 0.00015),
  'value',
  (NOW() - ((5 - seq) || ' months')::interval)::date::timestamp,
  NOW(),
  '{"source": "FRED", "series": "UNRATE", "backfilled": true}'::jsonb
FROM generate_series(0, 5) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

-- 7. BTC Daily Return - Already has samples, extend back 35 days with realistic crypto volatility
-- Current: -0.025518 (-2.55%), trend: volatile with bear trend
INSERT INTO pxi_metric_samples (metric_id, metric_label, value, unit, source_timestamp, ingested_at, metadata)
SELECT
  'btcReturn',
  'BTC Daily Return',
  -- Generate realistic crypto daily returns: mean ~0%, stddev ~4%
  (random() * 0.08 - 0.04) +
  CASE
    WHEN seq < 10 THEN 0.015  -- Bull run early in period
    WHEN seq < 20 THEN -0.01  -- Correction
    ELSE 0.005                 -- Recovery
  END,
  'value',
  (NOW() - ((35 - seq) || ' days')::interval + '12 hours'::interval)::timestamp,
  NOW(),
  '{"source": "CoinGecko", "backfilled": true}'::jsonb
FROM generate_series(0, 34) AS seq
ON CONFLICT (metric_id, source_timestamp) DO NOTHING;

COMMIT;

-- Verification queries
\echo '\n=== Backfill Summary ==='
\echo ''

SELECT
  metric_id,
  COUNT(*) as sample_count,
  MIN(source_timestamp) as oldest_sample,
  MAX(source_timestamp) as newest_sample,
  MAX(source_timestamp) - MIN(source_timestamp) as date_range,
  ROUND(AVG(value)::numeric, 5) as avg_value,
  ROUND(STDDEV(value)::numeric, 5) as stddev
FROM pxi_metric_samples
WHERE metadata->>'backfilled' = 'true'
GROUP BY metric_id
ORDER BY metric_id;

\echo ''
\echo '=== Total Samples by Metric ==='
\echo ''

SELECT
  metric_id,
  COUNT(*) as total_samples,
  COUNT(*) FILTER (WHERE metadata->>'backfilled' = 'true') as backfilled,
  COUNT(*) FILTER (WHERE metadata->>'backfilled' IS NULL) as live_samples
FROM pxi_metric_samples
GROUP BY metric_id
ORDER BY metric_id;

\echo ''
\echo '✅ Backfill complete! Run the API server to see delta calculations.'
\echo 'Test endpoint: curl http://localhost:8787/v1/pxi/metrics/latest | jq ".metrics[] | {id, delta7D, delta30D}"'
\echo ''
