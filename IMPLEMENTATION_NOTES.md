# PXI Data Feed Notes

| Metric | Provider | Endpoint | Auth | Unit & Transform | Sample Payload |
| ------ | -------- | -------- | ---- | ---------------- | -------------- |
| HY OAS | Federal Reserve Economic Data (FRED) | `https://api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2&file_type=json&sort_order=desc&limit=1` | API key via `FRED_API_KEY` query param | FRED returns percent; convert to decimal percent (`value / 100`) and timestamp as `YYYY-MM-DDT00:00:00Z`. | `{ "observations": [{ "date": "2024-05-10", "value": "3.98" }] }` |
| IG OAS | FRED | `series_id=BAMLC0A4CBBB` same endpoint shape as above | `FRED_API_KEY` | Percent -> decimal percent. | same as above |
| VIX | AlphaVantage | `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=^VIX` | API key via `ALPHA_VANTAGE_API_KEY` | Already in index points; no conversion. Timestamp from `07. latest trading day`. | `{ "Global Quote": { "05. price": "14.23", "07. latest trading day": "2024-05-24" } }` |
| U-3 | FRED | `series_id=UNRATE` | `FRED_API_KEY` | Percent -> decimal ratio. | `{ "observations": [{ "date": "2024-04-01", "value": "3.9" }] }` |
| USD Index (DXY) | Twelve Data | `https://api.twelvedata.com/time_series?symbol=DXY&interval=5min&outputsize=1` | API key via `TWELVEDATA_API_KEY` header/query | Already index value; ensure timestamp parsed as UTC. | `{ "values": [{ "datetime": "2024-05-24 15:55:00", "close": "105.36" }] }` |
| NFCI | FRED | `series_id=NFCI` | `FRED_API_KEY` | Direct index; no conversion. | `{ "observations": [{ "date": "2024-05-17", "value": "-0.20" }] }` |
| BTC Daily Return | CoinGecko | `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=daily` | Public (no key) but rate limited; optional proxy via `COINGECKO_BASE`. | Compute `(today - yesterday) / yesterday`. Timestamp from latest price epoch. | `{ "prices": [[1716336000000, 69000.1],[1716422400000, 71250.6]] }` |

Validation rules in `packages/data-ingest/src/validator.ts` ensure HY spread exceeds IG spread, guardrails for unrealistic jumps, and stale detection logs when feeds age >5 minutes (`config.staleThresholdMs`).
