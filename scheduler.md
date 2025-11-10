# Scheduler Configuration

Run both the ingestion and compute engines every minute via your orchestrator of choice (AWS EventBridge, CloudWatch, or Kubernetes CronJob).

```cron
# ┌───────── minute (0 - 59)
# │ ┌─────── hour (0 - 23)
# │ │ ┌───── day of the month (1 - 31)
# │ │ │ ┌─── month (1 - 12)
# │ │ │ │ ┌─ day of the week (0 - 6)
# │ │ │ │ │
* * * * * /usr/bin/node packages/data-ingest/dist/index.js
* * * * * /usr/bin/node packages/compute-engine/dist/index.js
```

Set the cron expression via `INGEST_CRON` and `ENGINE_CRON` environment variables when deploying to serverless (ex: AWS Lambda + EventBridge rule with fixed 1-minute rate) or container schedulers.
