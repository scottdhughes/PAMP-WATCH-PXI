# PAMP Index (PXI) Platform

> **Production-ready financial stress index platform** with k-means regime detection, statistical validation, real-time monitoring, and comprehensive backtesting capabilities.

A TypeScript-based platform that aggregates macro/market data from multiple financial APIs (FRED, AlphaVantage, TwelveData, CoinGecko), computes a normalized composite PXI using statistical z-scores, provides k-means clustering for regime classification, and delivers real-time visualization via a Next.js dashboard with regime-aware analytics.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [PXI Methodology](#-pxi-methodology)
- [Regime Detection](#-regime-detection)
- [Validation & Testing](#-validation--testing)
- [API Documentation](#-api-documentation)
- [Development](#-development)
- [Deployment](#-deployment)
- [Monitoring](#-monitoring)
- [Contributing](#-contributing)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features

### Core Functionality
- **Statistical Z-Score Analysis**: Calculates z-scores using 90-day rolling window statistics
- **Weighted Composite Index**: 10 systemic risk metrics with total weight of 11.2
- **K-Means Regime Detection**: Unsupervised clustering for market regime classification (Calm, Normal, Stress)
- **Real-Time Dashboard**: Minimalist command-center design with 60-second polling
- **Historical Analysis**: 30-day trend charts with regime background overlays
- **Comprehensive Validation**: Multi-layer validation with z-score accuracy testing (≤1e-6 tolerance)
- **Backtest Engine**: Strategy testing with regime filtering DSL

### Phase 1.5 Regime Detection
- ✅ **K-Means Clustering**: 3-cluster classification on 10-dimensional feature space (k=3, seed=42)
- ✅ **Daily Scheduler**: Automated regime computation at 02:30 UTC
- ✅ **Regime Analytics Dashboard**: Centroids, scatter plots, 30-day drift analysis (`/analytics/regime`)
- ✅ **Historical Overlays**: Color-coded regime background bands on PXI charts
- ✅ **Transition Alerts**: Slack/Discord webhook notifications on regime changes
- ✅ **Backtest Integration**: Regime-aware strategy testing with performance breakdown

### PXI Validation System
- ✅ **Comprehensive Test Suite**: Metric-level, composite, system-level, and data integrity checks
- ✅ **Validation Reporting**: Daily JSON validation logs with z-score recomputation
- ✅ **Methodology Documentation**: Complete explanation of PXI calculation and interpretation
- ✅ **Dashboard Enhancements**: Δ7D and Δ30D delta displays with color coding
- ✅ **Acceptance Criteria**: Z-score ≤1e-6, composite ≤0.001, correlation checks

### Data Quality & Accuracy Enhancements (Phase 2)
- ✅ **Sparse Data Forward-Fill**: Automatic forward-filling for metrics with <50% daily coverage (e.g., U-3 unemployment)
- ✅ **BTC 3-Day MA Smoothing**: Reduces cryptocurrency volatility noise with 3-day moving average on daily returns
- ✅ **Auto-Refresh Stale Cache**: Automatically refreshes BTC technical indicators when cache exceeds 48 hours
- ✅ **Contribution Cap**: Configurable 25% max contribution per metric prevents single-metric dominance (via `MAX_METRIC_CONTRIBUTION` env var)
- ✅ **Weight Redistribution**: Excess weight from capped metrics redistributed proportionally to non-capped metrics

### Operational Robustness & Intelligence (Phase 3)
- ✅ **FRED API Caching**: In-memory response caching with configurable TTL (default 2 hours) reduces API calls, improves speed, and handles transient outages
- ✅ **Auto-Suggest Bound Adjustments**: Detects frequent deviation alerts (>5 in 30 days) and suggests widening metric bounds by 20% to reduce false alerts
- ✅ **Cache Statistics**: Built-in cache monitoring with size and key tracking for diagnostics

### Quantitative Optimization (Phase 4)
- ✅ **Correlation-Based Weight Optimization**: Analyzes historical data to suggest optimal metric weights based on correlation with PXI or regime predictions
- ✅ **Statistical Analysis Library**: Pearson correlation, mean, standard deviation, Sharpe ratio, alignment scoring, and z-score normalization utilities
- ✅ **Historical Data Fetchers**: Database functions to retrieve metric history and PXI/regime data for backtesting and optimization
- ✅ **JSON Output for Review**: Optimization results saved to `optimization-results/` directory with detailed metrics, correlations, and recommendations
- ✅ **Configurable Analysis Period**: Run optimization on 30, 90, 365+ days of historical data via command-line arguments

### Statistical Regime Forecasting (Phase 5.1)
- ✅ **Exponential Smoothing**: Reduces noise in PXI time series while preserving trend (configurable alpha parameter, default 0.3)
- ✅ **Linear Regression Forecasting**: Projects PXI values up to 7 days ahead with 95% confidence intervals
- ✅ **Automated Regime Classification**: Maps forecasted PXI to regime categories (Crisis, Elevated Stress, Normal, Moderate PAMP, Strong PAMP)
- ✅ **Confidence Scoring**: Confidence probabilities (0.5-1.0) based on confidence interval width
- ✅ **Database Storage**: Forecasts stored in `pxi_forecasts` table with timestamps, horizons, and method tracking
- ✅ **JSON Export**: Forecast results with trend analysis and regime distribution saved to `prediction-results/` directory
- ✅ **CLI Tool**: Run forecasts with `npm run predict:regime -- --horizon=7 --days=365 --alpha=0.3`

### LSTM Regime Forecasting (Phase 5.2)
- ✅ **Deep Learning Architecture**: 2-layer LSTM with 64 hidden units, dropout regularization, and Adam optimizer
- ✅ **Python Integration**: PyTorch-based predictor with TypeScript wrapper for seamless integration
- ✅ **Virtual Environment Support**: Auto-detects and uses Python venv if available
- ✅ **Model Persistence**: Save/load trained models to avoid retraining (stored in `ml/models/`)
- ✅ **Min-Max Normalization**: Scales PXI values to [-1, 1] range for optimal LSTM training
- ✅ **Multi-Day Forecasting**: Generates forecasts up to 14+ days ahead with decreasing confidence
- ✅ **Training Metrics**: Train/validation loss tracking with best model checkpointing
- ✅ **Database Integration**: Forecasts stored with method='lstm' for comparison with statistical methods
- ✅ **CLI Tool**: Run with `npm run predict:regime:lstm -- --horizon=7 --days=365 --retrain`

### Production Features
- ✅ **Error Handling**: Comprehensive error handling with retry logic and exponential backoff
- ✅ **Rate Limiting**: 100 req/min default with configurable limits
- ✅ **CORS Security**: Whitelist-based origin control
- ✅ **Request Caching**: In-memory cache with configurable TTL (10s default)
- ✅ **API Versioning**: `/v1/` endpoints for backward compatibility
- ✅ **Health Checks**: Database connectivity testing at `/healthz`
- ✅ **Structured Logging**: Pino logger with request ID tracking
- ✅ **Graceful Shutdown**: Proper cleanup of connections and resources

---

## 🏗 Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  External APIs  │────▶│  Data Ingestion  │────▶│   TimescaleDB   │
│  (FRED, Alpha   │     │  (with retry)    │     │  (time-series)  │
│   Vantage, etc) │     └──────────────────┘     └─────────────────┘
└─────────────────┘                                       │
                                                          ▼
                                               ┌─────────────────────┐
                                               │  Compute Engines    │
                                               │  • PXI Algorithm    │
                                               │  • K-Means Regime   │
                                               │  • Validation       │
                                               └─────────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js UI    │◀────│   Fastify API    │◀────│   Composites &  │
│  • Dashboard    │     │ (v1, cached)     │     │  Regime Tables  │
│  • Analytics    │     └──────────────────┘     └─────────────────┘
└─────────────────┘
```

### Data Flow
1. **Ingestion**: External APIs → Fetchers (with retry) → Validator → Database
2. **Computation**: Database → PXI Algorithm → Composites Table
3. **Regime Detection**: Daily scheduler (02:30 UTC) → K-Means → Regime Table
4. **API**: Composites → Cache → Response Builder → Client
5. **UI**: Polling (60s) → API → React Components → User

---

## 📁 Project Structure

```
PAMP-WATCH-PXI/
├── app/                          # Next.js App Router
│   ├── dashboard/page.tsx        # Main PXI dashboard with deltas & regime bands
│   ├── analytics/regime/page.tsx # Regime analytics (centroids, scatter, drift)
│   ├── layout.tsx                # Root layout with React Query provider
│   └── providers.tsx             # React Query client configuration
│
├── shared/                       # Shared types and configuration
│   ├── types.ts                  # TypeScript type definitions
│   ├── pxiMetrics.ts            # Metric bounds, weights, risk directions
│   └── index.ts                  # Module exports
│
├── workers/                      # Background computation workers
│   ├── compute-worker.ts         # PXI calculation with normalized weights
│   ├── compute-regime.ts         # K-means clustering (k=3, seed=42)
│   ├── ingest-worker.ts          # Real-time data ingestion
│   ├── backfill-worker.ts        # Historical FRED data (10 years)
│   ├── backfill-btc-worker.ts    # Historical BTC data (1 year)
│   └── daily-indicator-worker.ts # BTC technical indicators (RSI/MACD)
│
├── lib/                          # Core libraries
│   └── backtest-engine.ts        # Backtest engine with regime filtering DSL
│
├── scripts/                      # Database and utility scripts
│   ├── validate-pxi.ts           # Validation reporting (JSON logs)
│   ├── populate-historical-pxi-v3.sql  # Forward-fill historical PXI
│   └── compute-historical-pxi.ts       # TypeScript backfill alternative
│
├── tests/                        # Test suites
│   ├── pxi_validation.test.ts    # Comprehensive PXI validation (Vitest)
│   ├── config.test.ts            # Configuration validation tests
│   ├── security.test.ts          # Security tests
│   └── validator.test.ts         # Input validation tests
│
├── clients/                      # External API clients (with retry logic)
│   ├── fredClient.ts            # Federal Reserve Economic Data
│   ├── alphaVantageClient.ts    # AlphaVantage (VIX)
│   ├── twelveDataClient.ts      # TwelveData (DXY)
│   └── coinGeckoClient.ts       # CoinGecko (BTC)
│
├── migrations/                   # Database migrations
│   ├── 001_initial_schema.sql   # TimescaleDB setup
│   ├── 002_enhanced_schema.sql  # Z-scores, contributions, alerts
│   ├── 003_btc_indicators.sql   # Technical indicators table
│   └── 007_add_pxi_regimes.sql  # K-means regime table
│
├── docs/                         # Documentation
│   ├── pxi-methodology.md        # Complete PXI calculation methodology
│   ├── IMPLEMENTATION_NOTES.md   # External API details & integration notes
│   ├── IMPLEMENTATION_SUMMARY.md # Phase-by-phase delivery log
│   ├── PXI_ENHANCEMENT_SPEC.md   # Original enhancement specification
│   ├── scheduler.md              # Cron configuration and automation plan
│   ├── SETUP.md                  # Environment/bootstrap instructions
│   └── TEST_REPORT.md            # QA + validation outcomes
│
├── utils/                        # Utility functions
│   ├── fetcher.ts               # API fetch utility for React Query
│   └── analytics.ts             # Risk metrics (Sharpe, Sortino, drawdown, absolute volatility)
│
├── hooks/                        # React hooks
│   └── useDashboardSnapshot.ts  # Dashboard polling hook
│
├── components/                   # React components
│   └── StaleIndicator.tsx       # Stale data indicator component
│
├── config.ts                     # Environment variable validation
├── db.ts                         # Database connection pool & queries
├── server.ts                     # Fastify API with regime endpoints
├── scheduler.ts                  # Cron scheduler with regime detection
├── fetchers.ts                   # Metric fetcher orchestration
├── validation.ts                 # Quantitative validation layer
├── buildLatestResponse.ts        # API response builder (regime-aware)
├── logger.ts                     # Pino logger configuration
│
├── docker-compose.yml            # Local development with TimescaleDB
├── .env.example                  # Environment variable template
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # This file
```

---

## 🔧 Prerequisites

- **Node.js** 20+ (LTS recommended)
- **PostgreSQL** 15+ or **TimescaleDB** 2.14+
- **Python** 3.8+ (required for Phase 5.2 LSTM forecasting)
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

### 2. Setup Python for LSTM Forecasting (Phase 5.2)

**Create virtual environment and install dependencies:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Verify installation:**
```bash
python3 -c "import torch, numpy, psycopg2; print('OK')"
```

### 3. Configure Environment

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

**Optional configuration:**
```env
# Data Quality Settings
MAX_METRIC_CONTRIBUTION=0.25    # Max 25% contribution per metric (prevents dominance)

# Rate Limiting
RATE_LIMIT_MAX=100              # Max requests per window
RATE_LIMIT_WINDOW=1 minute      # Time window for rate limiting
```

### 4. Start Database

**Using Docker Compose** (Recommended)
```bash
docker-compose up -d timescaledb
```

**Apply Migrations:**
```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
psql $DATABASE_URL -f migrations/002_enhanced_schema.sql
psql $DATABASE_URL -f migrations/007_add_pxi_regimes.sql
```

### 4. Start Services

```bash
# Start API server
npm run server

# Start dashboard (optional)
npm run dev

# Start scheduler (for regime detection)
npm run scheduler

# Refresh ingest + compute + regime in one shot (after resets/backfills)
npm run worker:run:all
```

**Access Points:**
- API: `http://localhost:8787`
- Dashboard: `http://localhost:3000`
- Regime Analytics: `http://localhost:3000/analytics/regime`

---

## 🧮 PXI Methodology

### What is PXI?

**PXI (Panic Index)** is a **weighted composite z-score** that measures normalized macro-financial stress across 10 systemic risk indicators.

- **PXI = 0**: Neutral stress (average historical conditions)
- **PXI > 0**: Elevated stress (above historical average)
- **PXI < 0**: Subdued stress (below historical average)

> The dashboard shows both the real-time composite PXI and the daily k-means regime label. The clustering job only runs once per day, so the "Market Regime" banner may lag the live composite for a few hours after large moves.

### Calculation

```typescript
// 1. Calculate z-scores (90-day rolling window)
z_i = (value_i - μ_i) / σ_i

// 2. Apply polarity (negative polarity = invert z-score)
z_adjusted_i = z_i × polarity_multiplier

// 3. Calculate weighted composite
PXI = Σ (z_adjusted_i × w_i) / Σ w_i
```

### Metrics & Weights

| Metric | Weight | Polarity | Description |
|--------|--------|----------|-------------|
| **VIX Index** | 1.8 | Negative | CBOE Volatility Index (fear gauge) |
| **HY OAS** | 1.5 | Negative | High-yield credit spread |
| **STLFSI** | 1.4 | Negative | St. Louis Fed Financial Stress Index |
| **NFCI** | 1.3 | Negative | Chicago Fed National Financial Conditions |
| **IG OAS** | 1.2 | Negative | Investment-grade credit spread |
| **Yield Curve (10y-2y)** | 1.2 | Positive | Treasury yield curve slope |
| **Unemployment (U-3)** | 1.0 | Negative | Official unemployment rate |
| **BTC Daily Return** | 1.0 | Positive | Risk appetite proxy |
| **USD Index** | 0.8 | Positive | Broad trade-weighted dollar |
| **10y Breakeven Inflation** | 0 | Negative | Display-only (excluded from weighting) |

**Total Active Weight:** 11.2

See `docs/pxi-methodology.md` for complete methodology documentation.

---

## 🎯 Regime Detection

### K-Means Clustering

The system uses **unsupervised k-means clustering** (k=3, seed=42) on the 10-dimensional z-score feature space to classify market conditions:

- **Calm**: Low-stress cluster (generally PXI < 0)
- **Normal**: Moderate-stress cluster (generally -1 < PXI < 1)
- **Stress**: High-stress cluster (generally PXI > 1)

### Regime Analytics Dashboard

Access at `/analytics/regime`:

- **Cluster Centroids**: Mean z-scores for each regime across all features
- **VIX vs HY OAS Scatter**: Regime classification visualization
- **30-Day Drift Analysis**: Recent centroid drift from historical mean
- **Feature Importance**: Identify which metrics drive regime classification

### Regime Transition Alerts

Configure webhooks in `.env`:
```env
ALERT_ENABLED=true
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

Alerts are triggered when regime changes (e.g., Normal → Stress).

---

## ✅ Validation & Testing

### Comprehensive Test Suite

Run validation tests:
```bash
npm test tests/pxi_validation.test.ts
```

**Test Coverage:**
- Metric-level validation (z-score accuracy ≤1e-6)
- Composite PXI recomputation (≤0.001 tolerance)
- System-level sanity checks (PXI range, correlations)
- Data integrity (no NULLs, duplicates, stale data)
- Regime alignment checks

### Validation Reporting

Generate daily validation logs:
```bash
npx tsx scripts/validate-pxi.ts
```

Outputs JSON summary to `logs/validation/pxi_validation_YYYY-MM-DD.json` with:
- Z-score accuracy for each metric
- Manual PXI recomputation vs stored value
- Total weight verification
- Error details

### Acceptance Criteria

✅ Z-score match: ≤1e-6 tolerance
✅ Composite PXI match: ≤0.001 tolerance
✅ Total weight: 11.2 (excluding zero-weight metrics)
✅ VIX-HY OAS correlation: Positive
✅ Data freshness: <7 days

## 🔁 Automation & Ops

- `npm run worker:run:all` – sequentially runs ingest → compute → regime detection. Use it after backfills, DB restores, or whenever you need the whole pipeline refreshed.
- `npm run validate:full` – seeds deterministic PXI data and runs the full `PXI_VALIDATION_ENABLED=true vitest -- --run` suite. Ideal for CI before merging or deploying.

Both commands are safe to run repeatedly and make it easy to keep the system in sync without memorizing individual worker steps.

### Local Test Data Seeder

Need deterministic data without hitting external APIs?

```bash
# Populate TimescaleDB with 30 days of synthetic PXI samples
npm run seed:validation

# Run the full validation suite against the seeded data set
PXI_VALIDATION_ENABLED=true npm test -- --run

# Or run both steps together (ideal for CI)
npm run validate:full
```

The seeder truncates PXI tables, inserts normalized samples for every metric in `shared/pxiMetrics.ts`, and writes a matching composite record so `tests/pxi_validation.test.ts` passes end-to-end.

---

## 📡 API Documentation

### Base URL
```
Development: http://localhost:8787
```

### Core Endpoints

#### `GET /v1/pxi/latest`
Latest PXI composite with regime classification and Δ7D/Δ30D deltas.

**Response:**
```json
{
  "pxi": 0.497,
  "statusLabel": "Calm – +0.50",
  "calculatedAt": "2025-11-11T12:00:00Z",
  "metrics": [...],
  "regime": {
    "regime": "Calm",
    "pxiValue": 0.497
  }
}
```

#### `GET /v1/pxi/regime/latest`
Latest k-means regime classification with probabilities and centroids.

**Response:**
```json
{
  "regime": "Calm",
  "date": "2025-11-11",
  "probabilities": {
    "Calm": 0.85,
    "Normal": 0.12,
    "Stress": 0.03
  },
  "centroid": {
    "vix_zscore": -0.8,
    "hyOas_zscore": -0.6,
    ...
  }
}
```

#### `GET /v1/pxi/regime/history?days=90`
Historical regime classifications for chart overlays.

**Query Parameters:**
- `days` (optional): Number of days (1-365, default: 90)

**Response:**
```json
{
  "regimes": [
    {
      "date": "2025-11-11",
      "regime": "Calm",
      "pxiValue": 0.497,
      "probabilities": {...},
      "centroid": {...}
    }
  ],
  "count": 90
}
```

#### `POST /v1/pxi/backtest`
Run backtest with regime filtering DSL.

**Request Body:**
```json
{
  "startDate": "2025-01-01",
  "endDate": "2025-11-11",
  "initialCapital": 100000,
  "rules": [
    {
      "name": "Stress Regime Short",
      "when": {
        "regime": ["Stress"],
        "pxi": { "gt": 1.0 }
      },
      "action": "short"
    }
  ]
}
```

**Response:**
```json
{
  "totalReturn": 8.5,
  "cagr": 15.2,
  "sharpe": 1.45,
  "maxDrawdown": 12.3,
  "trades": 42,
  "winRate": 65.4,
  "regimeBreakdown": {
    "Stress": {
      "trades": 15,
      "return": 12.3,
      "cagr": 25.6,
      "sharpe": 2.1
    }
  }
}
```

#### `GET /v1/pxi/history?days=30`
Historical PXI data for charting.

#### `GET /v1/pxi/analytics/risk-metrics`
Comprehensive risk analytics (Sharpe, Sortino, max drawdown, volatility in σ units).

#### `GET /healthz`
Health check with database connectivity test.

See full API documentation in the code comments.

---

## 💻 Development

### Available Scripts

```bash
# Development
npm run dev              # Start Next.js dashboard (localhost:3000)
npm run server           # Start API server (localhost:8787)
npm run scheduler        # Start cron scheduler with regime detection

# Workers
npm run worker:compute            # Run PXI calculation (one-time)
npm run worker:compute:regime     # Run regime detection (one-time)
npm run worker:backfill           # Backfill 10 years FRED data
npm run worker:backfill:btc       # Backfill 1 year BTC data
npm run worker:ingest             # Manual data ingestion

# Validation
npx tsx scripts/validate-pxi.ts   # Generate validation report
npm test                          # Run all tests
npm test tests/pxi_validation.test.ts  # Run PXI validation tests

# Optimization (Phase 4)
npm run optimize:weights                    # Run weight optimization (default: 365 days, target: pxi)
npm run optimize:weights -- --days=90       # Optimize using 90 days of history
npm run optimize:weights -- --target=regime # Optimize for regime prediction
npm run optimize:weights -- --days=180 --target=pxi  # Custom period and target

# Regime Forecasting (Phase 5.1: Statistical)
npm run predict:regime                           # Generate 7-day forecast (default: 365 days history, alpha=0.3)
npm run predict:regime -- --horizon=14           # Forecast 14 days ahead
npm run predict:regime -- --days=180 --alpha=0.4 # Use 180 days history with custom smoothing
npm run predict:regime -- --horizon=7 --days=90 --alpha=0.25  # Full customization

# Regime Forecasting (Phase 5.2: LSTM)
npm run predict:regime:lstm                      # Generate 7-day LSTM forecast (uses cached model)
npm run predict:regime:lstm -- --retrain         # Train new LSTM model from scratch
npm run predict:regime:lstm -- --horizon=14      # Forecast 14 days ahead
npm run predict:regime:lstm -- --days=180 --retrain  # Train on 180 days of history

# Build
npm run build            # Build Next.js application
npm run compile          # Compile TypeScript to JavaScript

# Utilities
npm run lint             # Run linter
```

### Scheduler Configuration

The scheduler runs automated tasks:
- **00:05 UTC**: Daily BTC indicator computation
- **02:00 UTC**: Daily data ingestion (FRED, AlphaVantage, etc.)
- **02:30 UTC**: Daily regime detection (k-means)
- **12:05 UTC**: Midday BTC indicator update

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
- [ ] Set up log aggregation
- [ ] Configure alerts for stale feeds and regime transitions
- [ ] Set up database backups
- [ ] Monitor `/healthz` endpoint
- [ ] Run validation tests: `npm test`
- [ ] Verify regime detection: Check `pxi_regimes` table

---

## 📊 Monitoring

### Key Metrics to Monitor

1. **PXI Accuracy**
   - Z-score accuracy (should be ≤1e-6)
   - Composite PXI match (should be ≤0.001)
   - Total weight verification (11.2)

2. **Regime Detection**
   - Daily regime computation success rate
   - Regime transition frequency
   - Centroid drift analysis

3. **API Performance**
   - Request latency (p50, p95, p99)
   - Cache hit rate
   - Error rate

4. **Data Quality**
   - Stale data warnings
   - NULL value counts
   - Duplicate timestamp checks

### Alerts

Configure alerts for:
- ⚠️ PXI validation failures
- ⚠️ Regime detection failures
- ⚠️ Stale feeds >5 minutes
- ⚠️ Z-score accuracy >1e-6
- ⚠️ Database connection failures

---

## 🤝 Contributing

### Development Workflow

1. Create a feature branch
2. Make changes with tests
3. Run validation: `npm test`
4. Run linter: `npm run lint`
5. Commit with descriptive messages
6. Push and create pull request

> ⚠️ Direct pushes to `main` are discouraged. Always open a pull request from a feature branch so validation + code review can run before merge.

### Code Style

- TypeScript strict mode enabled
- ESLint + Prettier for formatting
- JSDoc comments for public functions
- Comprehensive error handling
- Test coverage for critical paths

---

## 🐛 Troubleshooting

### Common Issues

**Dashboard not showing deltas:**
```bash
# Check historical data exists
psql $DATABASE_URL -c "SELECT COUNT(*) FROM composite_pxi_regime WHERE timestamp >= NOW() - INTERVAL '30 days';"

# Verify API returns history
curl http://localhost:8787/v1/pxi/history?days=30
```

**Regime detection not running:**
```bash
# Check scheduler is running
ps aux | grep scheduler

# Manually trigger regime detection
npm run worker:compute:regime

# Check regime data
psql $DATABASE_URL -c "SELECT * FROM pxi_regimes ORDER BY date DESC LIMIT 5;"
```

**Validation tests failing:**
```bash
# Check z-score tolerance
npm test tests/pxi_validation.test.ts

# Generate validation report
npx tsx scripts/validate-pxi.ts

# Check logs
cat logs/validation/pxi_validation_*.json
```

**Database connection fails:**
```bash
# Verify TimescaleDB is running
docker-compose ps timescaledb

# Test connection
psql $DATABASE_URL -c "\dt"
```

**API server fails with `EADDRINUSE` (port 8787):**
```bash
# Find the PID holding the port
lsof -ti tcp:8787

# Kill it and restart the server
kill -9 <PID>
npm run server
```
Use `netstat -ano | find "8787"` + `taskkill /PID <PID> /F` on Windows.

---

## 📚 Additional Documentation

- **Methodology**: See `docs/pxi-methodology.md` for complete calculation details
- **API Specifics**: See `docs/IMPLEMENTATION_NOTES.md` for external API details
- **Scheduling**: See `docs/scheduler.md` for cron configuration
- **Testing**: See test files in `tests/` directory

---

## 📄 License

MIT License - Copyright (c) 2025 Scott D. Hughes

See [LICENSE](LICENSE) file for details.

---

## 🎯 Roadmap

### Completed ✅
- [x] Phase 1: Core PXI calculation with statistical validation
- [x] Phase 1.5: K-means regime detection
- [x] Regime analytics dashboard
- [x] Historical chart overlays
- [x] Backtest engine with regime filtering
- [x] Comprehensive validation framework
- [x] PXI methodology documentation
- [x] **Phase 2: Data Quality Enhancements** (November 2025)
  - [x] Sparse data forward-fill (U-3 unemployment)
  - [x] 3-day MA smoothing for BTC returns
  - [x] Auto-refresh stale BTC cache (>48 hours)
  - [x] Configurable 25% contribution cap with redistribution
- [x] **Phase 3: Operational Robustness & Intelligence** (November 2025)
  - [x] FRED API response caching (2-hour TTL, in-memory)
  - [x] Auto-suggest bound adjustments (frequent deviation detection)
  - [x] Cache monitoring and diagnostics
- [x] **Phase 4: Quantitative Optimization** (November 2025)
  - [x] Correlation-based weight optimization script
  - [x] Statistical analysis utilities (Pearson, Sharpe, alignment)
  - [x] Historical data fetchers for optimization
  - [x] JSON output with detailed recommendations
- [x] **Phase 5.1: Statistical Regime Forecasting** (November 2025)
  - [x] Exponential smoothing for trend extraction
  - [x] Linear regression forecasting with confidence intervals
  - [x] Automated regime classification from forecasts
  - [x] Database storage for forecast history
  - [x] CLI tool with configurable parameters
- [x] **Phase 5.2: LSTM Regime Forecasting** (November 2025)
  - [x] 2-layer LSTM neural network with PyTorch
  - [x] Python-TypeScript interop with venv support
  - [x] Model persistence and checkpointing
  - [x] Min-Max normalization for optimal training
  - [x] Multi-day forecasting with confidence scoring

### Future Enhancements
- [ ] UI enhancements for forecast visualization
- [ ] Real-time WebSocket updates
- [ ] Multi-timeframe analysis (hourly, daily, weekly)
- [ ] Additional clustering algorithms (DBSCAN, hierarchical)
- [ ] Custom alert rules engine
- [ ] Data export functionality (CSV, JSON)
- [ ] Mobile app
- [ ] Correlation alerts for diverging metrics
- [ ] Redis caching for multi-instance deployments
- [ ] Stale-while-revalidate caching strategy
- [ ] Automated weight application (after backtest validation)
- [ ] Parameter grid search for optimal thresholds
- [ ] Genetic algorithm for multi-objective optimization

---

**Built with ❤️ using TypeScript, Fastify, Next.js, TimescaleDB, and scikit-learn**
