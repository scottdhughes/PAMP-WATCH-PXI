#!/usr/bin/env bash
# Convenience script to refresh the full PXI pipeline (ingest -> compute -> regime)
# Useful for cron, Docker, or manual refreshes after DB restores/backfills
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[refresh-all] Running ingest..."
npm run worker:ingest

echo "[refresh-all] Running compute..."
npm run worker:compute

echo "[refresh-all] Running compute:regime..."
npm run worker:compute:regime

echo "[refresh-all] Done."
