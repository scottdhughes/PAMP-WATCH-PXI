# PXI Platform Setup Guide

This guide will help you set up and run the PXI (PAMP Index) Platform.

## Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose (for database)
- API keys for external data sources

## 1. Install Dependencies

```bash
npm install
```

## 2. Get API Keys

You'll need API keys from the following services:

### 2.1 FRED (Federal Reserve Economic Data)

**Free tier: ✅ Yes**

1. Go to: https://fred.stlouisfed.org/docs/api/api_key.html
2. Click "Request API Key"
3. Sign in or create an account
4. Fill out the API key request form
5. Copy your API key

**Provides:**
- High Yield OAS (BAMLH0A0HYM2)
- Investment Grade OAS (BAMLC0A4CBBB)
- U-3 Unemployment Rate (UNRATE)
- Chicago Fed NFCI (NFCI)

**Rate limits:** 120 requests/minute

### 2.2 Alpha Vantage

**Free tier: ✅ Yes (500 requests/day)**

1. Go to: https://www.alphavantage.co/support/#api-key
2. Enter your email and click "GET FREE API KEY"
3. Copy your API key from the confirmation page

**Provides:**
- VIX Volatility Index

**Rate limits:** 5 requests/minute (free), 75/minute (premium $49.99/mo)

### 2.3 TwelveData

**Free tier: ✅ Yes (800 requests/day)**

1. Go to: https://twelvedata.com/pricing
2. Click "Start Free" under the Free plan
3. Sign up for an account
4. Go to your dashboard and copy your API key

**Provides:**
- USD Dollar Index (DXY)

**Rate limits:** 8 requests/minute

### 2.4 CoinGecko

**Free tier: ✅ Yes (NO API key needed)**

CoinGecko's free API doesn't require authentication.

**Provides:**
- Bitcoin daily returns

**Rate limits:** 10-50 requests/minute

## 3. Configure Environment Variables

Edit the `.env` file in the project root (already created from `.env.example`):

```bash
# API Keys
FRED_API_KEY=your_fred_api_key_here
ALPHA_VANTAGE_API_KEY=your_alphavantage_key_here
TWELVEDATA_API_KEY=your_twelvedata_key_here

# Database (default for local Docker setup)
DATABASE_URL=postgresql://pxi:pxi123@localhost:5432/pxi

# Server
PORT=8787
HOST=0.0.0.0
CORS_ORIGINS=http://localhost:3000

# Next.js Frontend API Base
NEXT_PUBLIC_PXI_API_BASE=http://localhost:8787
```

## 4. Start the Database

Start TimescaleDB using Docker Compose:

```bash
docker-compose up -d timescaledb
```

Wait for the database to be ready (about 10-15 seconds), then run migrations:

```bash
docker exec -i pamp-watch-pxi-timescaledb-1 psql -U pxi -d pxi < migrations/001_initial_schema.sql
```

Verify the database is running:

```bash
docker-compose ps
```

## 5. Run the Workers (Data Ingestion)

The workers fetch data and compute the PXI index.

### Option 1: Run workers once

```bash
# Fetch all metrics from external APIs
npm run worker:ingest

# Compute PXI composite from fetched data
npm run worker:compute
```

### Option 2: Run workers sequentially

```bash
# Run both workers in sequence
npm run worker:run
```

### Option 3: Set up cron jobs (Production)

For production, set up cron jobs to run every minute:

```bash
# Edit crontab
crontab -e

# Add these lines (adjust paths as needed)
* * * * * cd /path/to/PAMP-WATCH-PXI && npm run worker:ingest >> /var/log/pxi-ingest.log 2>&1
* * * * * cd /path/to/PAMP-WATCH-PXI && npm run worker:compute >> /var/log/pxi-compute.log 2>&1
```

## 6. Start the API Server

In a new terminal, start the Fastify API server:

```bash
npm run server
```

The API will be available at http://localhost:8787

Test it:

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/v1/pxi/latest
```

## 7. Start the Frontend Dashboard

In another terminal, start the Next.js development server:

```bash
npm run dev
```

The dashboard will be available at http://localhost:3000

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     External Data Sources                    │
│  FRED  │  Alpha Vantage  │  TwelveData  │  CoinGecko       │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Ingest Worker (Every 1 minute)                  │
│  • Fetches 7 metrics from APIs                              │
│  • Validates data                                            │
│  • Stores in pxi_metric_samples table                       │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│             Compute Worker (Every 1 minute)                  │
│  • Reads latest samples from DB                             │
│  • Calculates z-scores                                       │
│  • Computes weighted PXI composite (0-100)                  │
│  • Detects breaches (PAMP/Stress states)                    │
│  • Stores in pxi_composites table                           │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    TimescaleDB Database                      │
│  • pxi_metric_samples (90-day retention)                    │
│  • pxi_composites (1-year retention)                        │
│  • pxi_hourly_metrics (continuous aggregate)                │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Fastify API Server (:8787)                  │
│  • GET /v1/pxi/latest - Latest PXI data                     │
│  • GET /healthz - Health check                              │
│  • 10-second caching                                         │
│  • Rate limiting (100 req/min)                              │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js Dashboard (:3000)                       │
│  • Real-time PXI display                                     │
│  • 60-second auto-refresh                                    │
│  • Gauge, metrics table, breach ticker                      │
│  • Dark/light mode                                           │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Database connection errors

Check if TimescaleDB is running:

```bash
docker-compose ps
docker-compose logs timescaledb
```

### Worker errors

Check the logs:

```bash
# Run with verbose logging
LOG_LEVEL=debug npm run worker:ingest
LOG_LEVEL=debug npm run worker:compute
```

### API rate limits

If you hit rate limits, consider:
- Upgrading to paid API tiers
- Adjusting the worker frequency (reduce from 1 minute to 5 minutes)
- Implementing better caching

### Frontend not loading data

1. Verify API server is running: `curl http://localhost:8787/v1/pxi/latest`
2. Check browser console for CORS errors
3. Verify `NEXT_PUBLIC_PXI_API_BASE` in `.env` matches the API server URL

## Production Deployment

For production deployment:

1. Use environment variables for all configuration
2. Set up proper cron jobs or Kubernetes CronJobs for workers
3. Use managed TimescaleDB (Timescale Cloud) instead of Docker
4. Enable HTTPS and configure proper CORS origins
5. Set up monitoring and alerting
6. Consider using PM2 or systemd for process management

## Cost Summary

| Service | Free Tier | Monthly Cost (if paid) |
|---------|-----------|------------------------|
| FRED | ✅ Free | N/A |
| Alpha Vantage | ✅ 500/day | $49.99 (Premium) |
| TwelveData | ✅ 800/day | $79 (Pro) |
| CoinGecko | ✅ Free | $129 (Pro) |
| TimescaleDB | ✅ Local Docker | $50 (Cloud) |
| **Total** | **$0/month** | **~$300/month** (all paid) |

## Support

For issues or questions:
- Check the logs: `docker-compose logs`
- Review the code in the `workers/` directory
- Ensure all environment variables are set correctly
