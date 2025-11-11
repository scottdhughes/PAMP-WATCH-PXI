# PAMP Index (PXI) Platform

> **Production-ready financial stress index platform** with statistical z-score analysis, 10-year historical backtesting, real-time monitoring, and enterprise-grade security.

A TypeScript-based platform that aggregates macro/market data from multiple financial APIs (FRED, AlphaVantage, TwelveData, CoinGecko), computes a normalized composite PXI using statistical z-scores with dynamic weighting, and provides real-time visualization via a Next.js dashboard with 30-day historical trend analysis.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Private-red.svg)]()

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Database Setup](#-database-setup)
- [Development](#-development)
- [API Documentation](#-api-documentation)
- [Deployment](#-deployment)
- [Monitoring](#-monitoring)
- [Security](#-security)
- [Contributing](#-contributing)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features

### Core Functionality
- **Statistical Z-Score Analysis**: Calculates z-scores using 10-year rolling window statistics (365-day mean/stddev)
- **Normalized Weight Calculation**: Ensures weights sum to 1.0 with proper contribution scaling
- **Dynamic Weighting**: α=1.5 multiplier for |z|>1.0, β=2.0 for |z|>2.0, plus BTC technical indicator signals
- **Historical Data System**: 30+ days of backfilled PXI data with forward-fill logic for infrequent metrics
- **Real-time Data Ingestion**: Fetches 7 metrics with retry logic and exponential backoff
- **Enhanced Dashboard**: Minimalist command-center design with:
  - Real-time PXI display with regime indicators
  - 30-day historical trend chart (Recharts)
  - Expandable system internals with full metric breakdown
  - Auto-refresh every 30 seconds (React Query)
  - Framer Motion animations
- **RESTful API**: Versioned API with multiple endpoints for analytics, history, and risk metrics
- **Time-Series Database**: TimescaleDB with enhanced schema for z-scores, contributions, and alerts

### Production Features
- ✅ **Error Handling**: Comprehensive error handling with retry logic and exponential backoff
- ✅ **Rate Limiting**: 100 req/min default with configurable limits
- ✅ **CORS Security**: Whitelist-based origin control
- ✅ **Request Caching**: In-memory cache with configurable TTL (10s default)
- ✅ **API Versioning**: `/v1/` endpoints for backward compatibility
- ✅ **Health Checks**: Database connectivity testing at `/healthz`
- ✅ **Structured Logging**: Pino logger with request ID tracking
- ✅ **Graceful Shutdown**: Proper cleanup of connections and resources
- ✅ **Connection Pooling**: Configurable PostgreSQL connection pools
- ✅ **Input Validation**: Type-safe validation with hard limits

### Monitoring & Observability
- 📊 Metrics endpoint at `/metrics`
- 📝 Structured JSON logging with correlation IDs
- 🔍 Stale feed detection (>5 minutes)
- ⚠️ Breach detection (Stress/Caution/Stable/PAMP)
- 📈 Database query performance tracking

---

## 🏗 Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  External APIs  │────▶│  Data Ingestion  │────▶│   TimescaleDB   │
│  (FRED, Alpha   │     │  (with retry)    │     │  (time-series)  │
│   Vantage, etc) │     └──────────────────┘     └─────────────────┘
└─────────────────┘                                       │
                                                          ▼
                                               ┌─────────────────┐
                                               │ Compute Engine  │
                                               │ (PXI Algorithm) │
                                               └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js UI    │◀────│   Fastify API    │◀────│   Composites    │
│  (Dashboard)    │     │ (v1, cached)     │     │     Table       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Data Flow
1. **Ingestion**: External APIs → Fetchers (with retry) → Validator → Database
2. **Computation**: Database → PXI Algorithm → Composites Table
3. **API**: Composites → Cache → Response Builder → Client
4. **UI**: Polling → API → React Components → User

---

## 📁 Project Structure

```
PAMP-WATCH-PXI/
├── app/                         # Next.js App Router
│   ├── dashboard/page.tsx       # Ornn-style minimalist dashboard
│   ├── layout.tsx               # Root layout with React Query provider
│   └── providers.tsx            # React Query client configuration
│
├── shared/                      # Shared types and configuration
│   ├── types.ts                 # TypeScript type definitions
│   ├── pxiMetrics.ts           # Metric bounds, weights, risk directions
│   └── index.ts                 # Module exports
│
├── workers/                     # Background computation workers
│   ├── compute-worker.ts        # Enhanced PXI calculation with normalized weights
│   ├── ingest-worker.ts         # Real-time data ingestion
│   ├── backfill-worker.ts       # Historical FRED data (10 years)
│   ├── backfill-btc-worker.ts   # Historical BTC data (1 year)
│   └── daily-indicator-worker.ts # BTC technical indicators (RSI/MACD)
│
├── scripts/                     # Database and utility scripts
│   ├── populate-historical-pxi-v3.sql  # Forward-fill historical PXI
│   └── compute-historical-pxi.ts       # TypeScript backfill alternative
│
├── clients/                     # External API clients (with retry logic)
│   ├── fredClient.ts           # Federal Reserve Economic Data
│   ├── alphaVantageClient.ts   # AlphaVantage (VIX)
│   ├── twelveDataClient.ts     # TwelveData (DXY)
│   └── coinGeckoClient.ts      # CoinGecko (BTC)
│
├── migrations/                  # Database migrations
│   ├── 001_initial_schema.sql  # TimescaleDB setup
│   ├── 002_enhanced_schema.sql # Z-scores, contributions, alerts
│   └── 003_btc_indicators.sql  # Technical indicators table
│
├── utils/                       # Utility functions
│   ├── fetcher.ts              # API fetch utility for React Query
│   └── analytics.ts            # Risk metrics (Sharpe, Sortino, drawdown)
│
├── config.ts                    # Environment variable validation
├── db.ts                        # Database connection pool & enhanced queries
├── server.ts                    # Fastify API with multiple endpoints
├── fetchers.ts                  # Metric fetcher orchestration
├── validator.ts                 # Input validation with hard limits
├── buildLatestResponse.ts       # API response builder (regime-aware)
├── logger.ts                    # Pino logger configuration
├── monitoring.ts                # Stale feed detection
│
├── docker-compose.yml           # Local development with TimescaleDB
├── .env.example                 # Environment variable template
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

---

## 🔧 Prerequisites

- **Node.js** 20+ (LTS recommended)
- **PostgreSQL** 15+ or **TimescaleDB** 2.14+
- **Docker** (optional, for local TimescaleDB)
- **API Keys**:
  - [FRED API Key](https://fred.stlouisfed.org/docs/api/api_key.html)
  - [AlphaVantage API Key](https://www.alphavantage.co/support/#api-key)
  - [TwelveData API Key](https://twelvedata.com/pricing)

---

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd PAMP-WATCH-PXI
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and configuration
```

**Required environment variables:**
```env
FRED_API_KEY=your_fred_api_key
ALPHA_VANTAGE_API_KEY=your_alphavantage_key
TWELVEDATA_API_KEY=your_twelvedata_key
DATABASE_URL=postgresql://pxi:password@localhost:5432/pxi
```

### 3. Start Database

**Option A: Using Docker Compose** (Recommended)
```bash
# Make sure to set POSTGRES_PASSWORD in .env first
docker-compose up -d timescaledb
```

**Option B: Local TimescaleDB**
```bash
# Apply migration
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### 4. Start the API Server

```bash
npm run server
```

The API will be available at `http://localhost:8787`

### 5. Start the Dashboard (Optional)

```bash
npm run dev
```

Dashboard available at `http://localhost:3000`

---

## ⚙️ Configuration

### Environment Variables

See `.env.example` for a complete list. Key variables:

#### API Keys (Required)
| Variable | Description | Example |
|----------|-------------|---------|
| `FRED_API_KEY` | Federal Reserve Economic Data API key | `abcd1234...` |
| `ALPHA_VANTAGE_API_KEY` | AlphaVantage API key for VIX | `DEMO` |
| `TWELVEDATA_API_KEY` | TwelveData API key for DXY | `xyz789...` |

#### Database (Required)
| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `DB_POOL_MAX` | `10` | Maximum connection pool size |
| `DB_POOL_MIN` | `2` | Minimum connection pool size |

#### Server Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | API server port |
| `HOST` | `0.0.0.0` | Host binding |
| `NODE_ENV` | `development` | Environment mode |

#### Security
| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit time window |

#### Caching
| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_ENABLED` | `true` | Enable response caching |
| `CACHE_TTL_SECONDS` | `10` | Cache TTL in seconds |

#### Monitoring
| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `STALE_THRESHOLD_MS` | `300000` | Stale feed threshold (5 min) |

---

## 🧮 PXI Calculation Methodology

### Statistical Z-Score Analysis

The PXI uses a **normalized statistical approach** based on 10-year rolling window z-scores:

```typescript
z-score = (current_value - rolling_mean) / rolling_stddev
```

- **Rolling Window**: 365-day historical statistics for each metric
- **Normalization**: Weights are normalized to sum = 1.0
- **Direction**: Risk direction multipliers ensure consistent interpretation
  - `higher_is_more_risk` (e.g., VIX): direction = -1
  - `higher_is_less_risk` (e.g., HY OAS): direction = 1

### Dynamic Weighting

Weights are dynamically adjusted based on z-score magnitude:

| Z-Score Range | Multiplier | Description |
|---------------|------------|-------------|
| \|z\| ≤ 1.0 | 1.0 | Normal conditions |
| 1.0 < \|z\| ≤ 2.0 | α = 1.5 | Elevated signal |
| \|z\| > 2.0 | β = 2.0 | Strong signal |

### BTC Technical Indicators

Bitcoin returns include a **signal multiplier** from technical analysis:

```typescript
signal_multiplier = 1.0 + (RSI - 50) / 100 + (MACD_histogram > 0 ? 0.1 : -0.1)
```

- **RSI (14-day)**: Relative Strength Index
- **MACD (12,26,9)**: Moving Average Convergence Divergence
- **Update Frequency**: Twice daily (00:05 and 12:05 UTC)

### Composite Calculation

```typescript
// 1. Normalize weights to sum = 1.0
normalized_weight[i] = actual_weight[i] / total_weight

// 2. Calculate contributions
contribution[i] = normalized_weight[i] × z_score[i] × direction[i]

// 3. Sum contributions
PXI = Σ contribution[i]

// 4. Clamp to realistic range
PXI = clamp(PXI, -3, 3)
```

### Regime Classification

| PXI Range | Regime | Interpretation |
|-----------|--------|----------------|
| PXI > 2.0 | Strong PAMP | Very low systemic stress |
| 1.0 < PXI ≤ 2.0 | Moderate PAMP | Low stress |
| -1.0 ≤ PXI ≤ 1.0 | Normal | Normal conditions |
| -2.0 ≤ PXI < -1.0 | Elevated Stress | Heightened stress |
| PXI < -2.0 | Crisis | High systemic stress |

### Example Output

```
Metric      Z-Score  Weight   Contribution
─────────────────────────────────────────
hyOas       -0.854   0.1648   +0.1408
igOas       -1.113   0.1978   +0.2203
vix         +0.078   0.1978   -0.0155
u3          -0.168   0.1099   +0.0185
usd         +0.939   0.0879   +0.0826
nfci        -0.420   0.1429   +0.0600
btcReturn   -0.099   0.0989   -0.0098
─────────────────────────────────────────
                              = +0.497

Regime: Stable
Weight Sum: 1.0000
```

---

## 🗄 Database Setup

### Migration

The platform includes a comprehensive migration script that sets up:
- TimescaleDB hypertables with automatic partitioning
- Indexes for optimal query performance
- Retention policies (90 days for samples, 1 year for composites)
- Continuous aggregates for hourly rollups

```bash
# Run migration
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### Schema Overview

#### `pxi_metric_samples`
Stores raw metric data from external APIs.

```sql
(metric_id, source_timestamp) PRIMARY KEY
Indexes: metric_id + source_timestamp, ingested_at
Retention: 90 days
```

#### `pxi_composites`
Stores computed PXI composite scores.

```sql
id BIGSERIAL PRIMARY KEY
Indexes: calculated_at, pxi
Retention: 1 year
```

#### `pxi_hourly_metrics` (Continuous Aggregate)
Automatically maintained hourly rollups for analytics.

---

## 💻 Development

### Available Scripts

```bash
# Development
npm run dev          # Start Next.js dashboard dev server (localhost:3000)
npm run server       # Start API server (localhost:8787)

# Build
npm run build        # Build Next.js application
npm run compile      # Compile TypeScript to JavaScript

# Workers
npm run worker:compute        # Run PXI calculation worker (one-time)
npm run worker:backfill       # Backfill 10 years of FRED historical data
npm run worker:backfill:btc   # Backfill 1 year of BTC historical data
npm run worker:ingest         # Manual data ingestion run

# Historical Data
psql $DATABASE_URL -f scripts/populate-historical-pxi-v3.sql  # Populate 30 days of historical PXI

# Testing
npm run test         # Run tests with Vitest
npm run test:ui      # Run tests with UI

# Linting
npm run lint         # Run Next.js linter
```

### Adding New Metrics

1. **Define metric in shared config** (`shared/pxiMetrics.ts`):
```typescript
{
  id: 'newMetric',
  label: 'New Metric',
  lowerBound: 0,
  upperBound: 100,
  weight: 1.0,
  polarity: 'positive',
}
```

2. **Create fetcher** (`fetchers.ts`):
```typescript
{
  id: 'newMetric',
  label: 'New Metric',
  fetch: withErrorHandling('newMetric', async () => {
    // Fetch logic here
    return {
      id: 'newMetric',
      label: 'New Metric',
      value: fetchedValue,
      unit: 'index',
      sourceTimestamp: timestamp,
      ingestedAt: new Date().toISOString(),
    };
  }),
}
```

3. **Add validation limits** (`validator.ts`):
```typescript
const HARD_LIMITS: Record<MetricId, { min: number; max: number }> = {
  // ...
  newMetric: { min: 0, max: 100 },
};
```

4. **Update TypeScript types** (`shared/types.ts`):
```typescript
export type MetricId =
  | 'hyOas'
  | 'igOas'
  | 'vix'
  | 'u3'
  | 'usd'
  | 'nfci'
  | 'btcReturn'
  | 'newMetric'; // Add here
```

---

## 📡 API Documentation

### Base URL
```
Production: https://api.yourdomain.com
Development: http://localhost:8787
```

### Endpoints

#### `GET /healthz`
Health check endpoint with database connectivity test.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-10T12:00:00Z",
  "uptime": 3600.5
}
```

#### `GET /v1/pxi/latest`
Fetch the latest PXI composite data with regime classification.

**Headers:**
- `X-Cache`: `HIT` or `MISS` (cache status)

**Response:**
```json
{
  "pxi": 0.497,
  "statusLabel": "Stable – +0.50",
  "zScore": 0.497,
  "calculatedAt": "2025-11-10T12:00:00Z",
  "metrics": [
    {
      "id": "hyOas",
      "label": "HY OAS",
      "value": 0.045,
      "delta": 0.001,
      "lower": 0.03,
      "upper": 0.08,
      "zScore": -0.854,
      "contribution": 0.1408,
      "breach": "Stable"
    }
  ],
  "ticker": ["VIX Index - PAMP"],
  "alerts": [
    {
      "id": 123,
      "alertType": "high_z_score",
      "indicatorId": "vix",
      "timestamp": "2025-11-10T12:00:00Z",
      "zScore": 2.1,
      "message": "VIX z-score 2.10 exceeds threshold",
      "severity": "warning"
    }
  ],
  "regime": {
    "regime": "Stable",
    "pxiValue": 0.497,
    "totalWeight": 9.1,
    "pampCount": 0,
    "stressCount": 0
  }
}
```

#### `GET /v1/pxi/metrics/latest`
Get underlying metrics with z-scores and contributions.

**Response:**
```json
{
  "metrics": [
    {
      "id": "hyOas",
      "label": "HY OAS",
      "value": 0.045,
      "delta": 0.001,
      "lower": 0.03,
      "upper": 0.08,
      "zScore": -0.854,
      "contribution": 0.1408,
      "status": "Stable",
      "unit": "decimal"
    }
  ]
}
```

#### `GET /v1/pxi/history?days=30`
Get historical PXI data for charting.

**Query Parameters:**
- `days` (optional): Number of days to fetch (1-90, default: 30)

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2025-10-12T12:00:00.000Z",
      "pxiValue": -0.453,
      "regime": "Stable"
    }
  ],
  "days": 30,
  "count": 44
}
```

#### `GET /v1/pxi/analytics/risk-metrics`
Get comprehensive risk analytics (Sharpe, Sortino, max drawdown, volatility).

**Response:**
```json
{
  "sharpe": 1.2345,
  "sortino": 1.5678,
  "maxDrawdown": {
    "maxDrawdownPercent": 15.23,
    "peakValue": 2.5,
    "troughValue": -1.2,
    "peakIndex": 10,
    "troughIndex": 25,
    "peakTimestamp": "2025-10-15T12:00:00Z",
    "troughTimestamp": "2025-10-20T12:00:00Z"
  },
  "volatility": 12.45,
  "cumulativeReturn": 8.9,
  "daysAnalyzed": 85
}
```

#### `GET /v1/pxi/indicators/cache-status`
Get BTC technical indicators cache status.

**Response:**
```json
{
  "cached": true,
  "status": "fresh",
  "date": "2025-11-10",
  "updatedAt": "2025-11-10T12:05:00Z",
  "ageHours": 2.5,
  "thresholds": {
    "warning": 36,
    "stale": 48
  },
  "indicators": {
    "rsi": 45.67,
    "macdValue": 123.45,
    "macdSignal": 120.32,
    "signalMultiplier": 1.025
  },
  "nextUpdate": "Twice daily at 00:05 and 12:05 UTC"
}
```

#### `GET /pxi/latest` (Legacy)
Redirects to `/v1/pxi/latest` with 301 status.

#### `GET /metrics`
Monitoring metrics endpoint.

**Response:**
```json
{
  "uptime": 3600.5,
  "memoryUsage": {
    "rss": 52428800,
    "heapTotal": 18874368,
    "heapUsed": 12345678,
    "external": 123456
  },
  "cacheSize": 5,
  "timestamp": "2025-11-10T12:00:00Z"
}
```

### Rate Limits
- Default: 100 requests per minute per IP
- Localhost exempted
- Returns `429` when exceeded
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Caching
- Default TTL: 10 seconds
- Cache key: `pxi:latest`
- Check `X-Cache` header for cache status
- Configurable via `CACHE_TTL_SECONDS`

---

## 🚢 Deployment

### Docker Deployment

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop all services
docker-compose down
```

### Production Checklist

- [ ] Set strong `POSTGRES_PASSWORD`
- [ ] Configure `CORS_ORIGINS` whitelist
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS/TLS
- [ ] Configure rate limits appropriately
- [ ] Set up log aggregation (CloudWatch, Datadog, etc.)
- [ ] Configure alerts for stale feeds
- [ ] Set up database backups
- [ ] Monitor `/healthz` endpoint
- [ ] Enable query performance monitoring

### Environment-Specific Configs

**Development:**
```env
NODE_ENV=development
LOG_LEVEL=debug
CACHE_ENABLED=false
CORS_ORIGINS=*
```

**Production:**
```env
NODE_ENV=production
LOG_LEVEL=info
CACHE_ENABLED=true
CORS_ORIGINS=https://yourdomain.com,https://dashboard.yourdomain.com
RATE_LIMIT_MAX=1000
DB_POOL_MAX=20
```

### Kubernetes Deployment

See `cronjobs.yaml` and `timescaledb.yaml` for Kubernetes manifests.

```bash
kubectl apply -f timescaledb.yaml
kubectl apply -f cronjobs.yaml
```

---

## 📊 Monitoring

### Logging

All logs are structured JSON via Pino:

```json
{
  "level": 30,
  "time": 1699545600000,
  "pid": 12345,
  "hostname": "api-server",
  "reqId": "req-xyz",
  "msg": "Request completed",
  "responseTime": 45
}
```

**Log Levels:**
- `fatal` (60): Process terminating
- `error` (50): Operation failed
- `warn` (40): Unexpected situation
- `info` (30): Normal operation
- `debug` (20): Detailed debugging
- `trace` (10): Very detailed

### Metrics to Monitor

1. **API Performance**
   - Request latency (p50, p95, p99)
   - Error rate
   - Cache hit rate
   - Rate limit rejections

2. **Database**
   - Connection pool utilization
   - Query performance
   - Failed queries
   - Stale data warnings

3. **External APIs**
   - Fetch success rate
   - Retry counts
   - API quota usage
   - Response times

4. **System**
   - Memory usage
   - CPU usage
   - Process uptime
   - Heap size

### Alerts

Configure alerts for:
- ⚠️ Health check failures
- ⚠️ Error rate >1%
- ⚠️ Stale feeds >5 minutes
- ⚠️ Database connection failures
- ⚠️ Memory usage >80%
- ⚠️ API quota approaching limits

---

## 🔒 Security

### Implemented Security Measures

1. **API Security**
   - ✅ CORS whitelist configuration
   - ✅ Rate limiting (100 req/min default)
   - ✅ Input validation on all endpoints
   - ✅ Request ID tracking

2. **Database Security**
   - ✅ Parameterized queries (SQL injection prevention)
   - ✅ Connection pooling with limits
   - ✅ Environment-based credentials
   - ✅ TLS/SSL support

3. **Configuration Security**
   - ✅ API key validation (format and length)
   - ✅ No hardcoded credentials
   - ✅ Environment variable validation
   - ✅ Secure defaults

4. **Error Handling**
   - ✅ No sensitive data in error messages
   - ✅ Graceful degradation
   - ✅ Proper error logging without exposing internals

### Security Best Practices

- 🔐 Rotate API keys regularly
- 🔐 Use strong database passwords (16+ chars)
- 🔐 Enable database encryption at rest
- 🔐 Use TLS for all connections
- 🔐 Implement API authentication for production
- 🔐 Regular security audits
- 🔐 Keep dependencies updated

---

## 🤝 Contributing

### Development Workflow

1. Create a feature branch
2. Make changes with tests
3. Run linter: `npm run lint`
4. Run tests: `npm run test`
5. Commit with descriptive messages
6. Push and create pull request

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- JSDoc comments for public functions
- Meaningful variable names
- Error handling on all async operations

### Testing

Write tests for:
- ✅ API endpoints
- ✅ Database operations
- ✅ External API clients
- ✅ Validation logic
- ✅ Metric calculations

---

## 🐛 Troubleshooting

### Common Issues

**API won't start:**
```bash
# Check environment variables
node -e "require('dotenv').config(); console.log(process.env)"

# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check logs
tail -f logs/api.log
```

**Database connection fails:**
```bash
# Verify TimescaleDB is running
docker-compose ps timescaledb

# Check connection string
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "\dt"
```

**External API failures:**
```bash
# Check API keys are set
env | grep API_KEY

# Test individual API
curl "https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=$FRED_API_KEY&file_type=json&limit=1"
```

**Rate limit issues:**
```bash
# Check current limits
curl http://localhost:8787/metrics

# Adjust in .env
RATE_LIMIT_MAX=1000
```

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm run server
```

### Getting Help

1. Check logs: `docker-compose logs -f`
2. Review configuration: `.env` file
3. Test health endpoint: `curl http://localhost:8787/healthz`
4. Check GitHub issues
5. Review `IMPLEMENTATION_NOTES.md` for API details

---

## 📚 Additional Documentation

- **API Details**: See `IMPLEMENTATION_NOTES.md` for external API specifics
- **Scheduling**: See `scheduler.md` for cron configuration
- **Infrastructure**: See `cronjobs.yaml` and `timescaledb.yaml`

---

## 📄 License

Private - All Rights Reserved

---

## 🎯 Roadmap

- [ ] Add Prometheus metrics exporter
- [ ] Implement WebSocket support for real-time updates
- [ ] Add user authentication and API keys
- [ ] Create admin dashboard
- [ ] Add more financial metrics
- [ ] Implement alerting system
- [ ] Add data export functionality
- [ ] Create mobile app

---

**Built with ❤️ using TypeScript, Fastify, Next.js, and TimescaleDB**
