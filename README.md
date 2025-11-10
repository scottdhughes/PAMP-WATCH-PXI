# PAMP Index (PXI)

Monorepo for Aixe Capital's PXI platform. Live ingestion services pull macro/market data every minute, compute the PXI composite and expose the data to a Tailwind/Next.js dashboard that auto-refreshes on the same cadence.

## Repository Layout

```
/packages
  data-ingest      # ETL workers fetching raw metrics into Timescale/Postgres
  compute-engine   # PXI scoring + breach logic, writes composites
  shared           # Shared TypeScript config (pxi metrics, bands, helpers)
  ui               # Next.js dashboard with live polling + Tailwind UI
pxiMetrics.ts      # Re-export of shared metric configuration per spec
infra/scheduler.md # Cron snippets for 60s cadence
IMPLEMENTATION_NOTES.md # API reference for every feed
```

## Environment Variables

| Variable | Description |
| -------- | ----------- |
| `DATABASE_URL` | PostgreSQL/Timescale connection string with `pxi_metric_samples` + `pxi_composites` tables. |
| `FRED_API_KEY` | FRED API key for HY/IG OAS, U-3, NFCI. |
| `ALPHA_VANTAGE_API_KEY` | AlphaVantage key for VIX. |
| `TWELVEDATA_API_KEY` | Twelve Data key for USD DXY feed. |
| `COINGECKO_BASE` | Optional override for CoinGecko base URL/proxy. |
| `INGEST_CRON` | Cron expression for ingestion (default `* * * * *`). |
| `ENGINE_CRON` | Cron expression for PXI compute (default `* * * * *`). |
| `PORT` | API server port when running `@pxi/api` (default `8787`). |
| `HOST` | Host binding for API server (default `0.0.0.0`). |
| `NEXT_PUBLIC_PXI_API_BASE` | Base URL the UI uses to call `/pxi/latest`. Point at your API gateway/Edge function that reads from `pxi_composites`. |

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS pxi_metric_samples (
  metric_id TEXT NOT NULL,
  metric_label TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (metric_id, source_timestamp)
);

CREATE TABLE IF NOT EXISTS pxi_composites (
  id BIGSERIAL PRIMARY KEY,
  calculated_at TIMESTAMPTZ NOT NULL,
  z_score DOUBLE PRECISION NOT NULL,
  pxi DOUBLE PRECISION NOT NULL,
  metrics JSONB NOT NULL,
  breaches JSONB NOT NULL
);
```

## Local Development

### Bootstrap dependencies

```bash
npm install
npm run build --workspaces
```

### Run ingestion every minute

```bash
cd packages/data-ingest
npm run dev
```

### Run compute engine every minute

```bash
cd packages/compute-engine
npm run dev
```

### Run the dashboard

```bash
cd packages/ui
npm run dev
```

Dashboard auto-refreshes via client-side polling every 60 seconds. Ensure `NEXT_PUBLIC_PXI_API_BASE` points at a running API (could be a lightweight Fastify service or Next.js API route that selects the latest row from `pxi_composites`).

### Run the public API

```bash
cd packages/api
npm run dev
```

The Fastify server exposes `GET /pxi/latest` and powers the dashboard + partner integrations. It queries the most recent composite, derives deltas from the prior minute, tags breaches (Stress / Caution / Stable / PAMP), and emits ticker text for active alerts. Point UI and downstream systems at this service.

### Tests

```bash
cd packages/data-ingest && npm run test
cd packages/compute-engine && npm run test
```

## Adding or Updating Metrics

1. Define the metric bounds, polarity and weight in `packages/shared/src/pxiMetrics.ts`. Root `pxiMetrics.ts` automatically re-exports the config.
2. Create a new fetcher inside `packages/data-ingest/src/fetchers.ts` that returns normalized units (decimal percent, UTC timestamps, etc.).
3. Update validation rules in `packages/data-ingest/src/validator.ts` if the new series needs custom guardrails.
4. The compute engine automatically picks up new metrics as long as their `id` matches between the config and insertions.

## Refresh Cadence

All services default to one-minute cadences via cron settings documented inside `infra/scheduler.md`. Keep data freshness consistent end-to-end: ingestion cron = compute cron = API refresh (instant) = UI polling interval.

## Deployment Notes

- **Backend**: Deploy ingestion + compute services as separate containers or Lambdas, each triggered by a one-minute scheduler (AWS EventBridge rule or Kubernetes CronJob). Push logs to CloudWatch/Loki and wire alerts for `Feed failure` or `Stale input` log patterns.
- **Database**: Use TimescaleDB for automatic retention + compression. Partition `pxi_metric_samples` daily to keep writes hot.
- **Public API**: `packages/api` is container-ready. See `infra/docker-compose.yml` for local orchestration and `infra/k8s/*.yaml` for Kubernetes objects that provision TimescaleDB plus one-minute CronJobs.
- **Frontend**: Deploy `packages/ui` to Vercel (Next 14 app router). Use ISR or the built-in polling hook (60s) for the `/pxi/latest` endpoint.
- **Monitoring**: Add Slack/email notifications off the log pipeline when `systemLevel` breach becomes non-null or when stale feeds are detected for >5 minutes.

## Documentation Assets

- **Implementation Notes**: `IMPLEMENTATION_NOTES.md` enumerates every provider, endpoint, auth, sample JSON, unit conversion.
- **UI Wireframe**: `packages/ui/WireframeMock.tsx` captures the hero, gauge, composite bar, metrics grid, and ticker layout with Tailwind tokens.
- **Scheduler + Infra Config**: `infra/scheduler.md` gives cron expressions, `infra/docker-compose.yml` provides local Timescale+API orchestration, and `infra/k8s/*.yaml` ship production-ready manifests (Timescale StatefulSet + CronJobs for ingestion/compute).
