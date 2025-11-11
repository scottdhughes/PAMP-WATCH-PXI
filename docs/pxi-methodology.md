# PXI Methodology

## Overview

**PXI (Panic Index)** is a **weighted composite z-score** that measures normalized macro-financial stress across 10 systemic risk indicators. It represents the aggregate deviation from historical norms, expressed in standard deviation units (σ).

Unlike percentage-based indices (e.g., 0-100 scales), PXI is a **z-score composite**, meaning:

- **PXI = 0**: Neutral stress (average historical conditions)
- **PXI > 0**: Elevated stress (above historical average)
- **PXI < 0**: Subdued stress (below historical average)

PXI provides a real-time, quantitative measure of systemic risk by synthesizing credit spreads, volatility, unemployment, currency strength, financial conditions, and inflation expectations into a single normalized metric.

---

## Calculation Methodology

### 1. Individual Metric Z-Scores

Each metric is normalized using a **rolling z-score**:

```
z_i = (value_i - μ_i) / σ_i
```

Where:
- `value_i` = Current raw value of metric `i`
- `μ_i` = Rolling mean of metric `i` (typically 90-day window)
- `σ_i` = Rolling standard deviation of metric `i` (unbiased estimator)

**Interpretation:**
- `z = 0`: Metric at historical average
- `z > 0`: Metric above average
- `z > 2`: Metric at 2+ standard deviations (extreme)

---

### 2. Polarity Adjustment

Metrics have different **risk directions**:

- **Negative polarity** (stress increases with higher values):
  - HY OAS, IG OAS, VIX, Unemployment, NFCI, STLFSI, Breakeven Inflation
  - Example: Higher VIX → higher stress
- **Positive polarity** (stress decreases with higher values):
  - USD Index, BTC Return, Yield Curve Slope
  - Example: Higher yield curve slope → lower stress

For **positive polarity** metrics, we **invert the z-score** to align risk direction:

```
z_adjusted = z_raw * polarity_multiplier
```

Where:
- `polarity_multiplier = 1` for negative polarity
- `polarity_multiplier = -1` for positive polarity

---

### 3. Weighted Composite PXI

PXI is calculated as a **weighted average** of adjusted z-scores:

```
PXI = Σ (z_adjusted_i × w_i) / Σ w_i
```

Where:
- `z_adjusted_i` = Polarity-adjusted z-score for metric `i`
- `w_i` = Weight for metric `i`
- `Σ w_i` = Total weight (sum of all non-zero weights)

**Current Weights (Total: 11.2):**

| Metric | Weight | Polarity | Rationale |
|--------|--------|----------|-----------|
| **VIX Index** | 1.8 | Negative | Highest weight; canonical volatility measure |
| **STLFSI** | 1.4 | Negative | Comprehensive Fed stress index |
| **HY OAS** | 1.5 | Negative | Key credit stress indicator |
| **NFCI** | 1.3 | Negative | Chicago Fed financial conditions |
| **IG OAS** | 1.2 | Negative | Investment-grade credit stress |
| **Yield Curve (10y-2y)** | 1.2 | Positive | Reliable recession indicator |
| **Unemployment (U-3)** | 1.0 | Negative | Labor market health |
| **BTC Daily Return** | 1.0 | Positive | Risk appetite proxy |
| **USD Index** | 0.8 | Positive | Flight-to-safety currency |
| **10y Breakeven Inflation** | 0 | Negative | Display-only (excluded from weighting) |

**Total Active Weight:** 11.2 (excluding Breakeven Inflation)

---

## Metric Definitions

### 1. HY OAS (High-Yield Option-Adjusted Spread)
- **Source:** FRED (BAMLH0A0HYM2)
- **Bounds:** 3%-8%
- **Weight:** 1.5
- **Risk Direction:** Higher is more risk
- **Description:** Credit spread between high-yield corporate bonds and Treasuries. Widens during stress as investors demand higher compensation for credit risk.

### 2. IG OAS (Investment-Grade Option-Adjusted Spread)
- **Source:** FRED (BAMLC0A4CBBB)
- **Bounds:** 1%-3%
- **Weight:** 1.2
- **Risk Direction:** Higher is more risk
- **Description:** Credit spread for investment-grade corporate bonds. More stable than HY OAS but still sensitive to credit conditions.

### 3. VIX Index (CBOE Volatility Index)
- **Source:** FRED (VIXCLS)
- **Bounds:** 12-25
- **Weight:** 1.8
- **Risk Direction:** Higher is more risk
- **Description:** Implied volatility of S&P 500 options. Known as the "fear gauge" of equity markets.

### 4. U-3 Unemployment Rate
- **Source:** FRED (UNRATE)
- **Bounds:** 3.5%-6%
- **Weight:** 1.0
- **Risk Direction:** Higher is more risk
- **Description:** Official unemployment rate. Rises during recessions and economic slowdowns.

### 5. USD Index (Broad Trade-Weighted)
- **Source:** FRED (DTWEXBGS)
- **Bounds:** 100-130
- **Weight:** 0.8
- **Risk Direction:** Higher is less risk
- **Description:** Broad U.S. dollar strength. Strengthens during flight-to-safety (risk-off) episodes.

### 6. NFCI (Chicago Fed National Financial Conditions Index)
- **Source:** FRED (NFCI)
- **Bounds:** -0.5 to 0.5
- **Weight:** 1.3
- **Risk Direction:** Higher is more risk
- **Description:** Composite index of 105 financial indicators. Negative values indicate looser-than-average conditions.

### 7. BTC Daily Return
- **Source:** CoinGecko
- **Bounds:** -5% to +5%
- **Weight:** 1.0
- **Risk Direction:** Higher is less risk
- **Description:** Daily return of Bitcoin. Serves as a proxy for risk appetite in digital assets.

### 8. Yield Curve Slope (10y-2y)
- **Source:** FRED (DGS10, DGS2)
- **Bounds:** -1.0 to 3.0 percentage points
- **Weight:** 1.2
- **Risk Direction:** Higher is less risk
- **Description:** Spread between 10-year and 2-year Treasury yields. Inversions (negative slope) have historically preceded recessions.

### 9. STLFSI (St. Louis Fed Financial Stress Index)
- **Source:** FRED (STLFSI2)
- **Bounds:** -1.0 to 1.5
- **Weight:** 1.4
- **Risk Direction:** Higher is more risk
- **Description:** Comprehensive measure of financial market stress across 18 weekly data series. Zero indicates average stress.

### 10. 10-Year Breakeven Inflation
- **Source:** FRED (T10YIE)
- **Bounds:** 1%-3%
- **Weight:** 0 (Display-only)
- **Risk Direction:** Higher is more risk
- **Description:** Market-implied inflation expectations derived from TIPS spreads. Excluded from PXI weighting but monitored for context.

---

## Interpretation Guidelines

### PXI Ranges

| PXI Range | Interpretation | Market State |
|-----------|----------------|--------------|
| **PXI < -2** | Extreme calm | Complacency risk; very low volatility |
| **-2 ≤ PXI < -1** | Below-average stress | Favorable conditions |
| **-1 ≤ PXI < 1** | Neutral | Normal market environment |
| **1 ≤ PXI < 2** | Elevated stress | Caution warranted |
| **PXI ≥ 2** | High stress | Crisis conditions |

### K-Means Regime Classification

In addition to the PXI value, the system uses **k-means clustering** (k=3, seed=42) to classify market conditions into three regimes based on the 10-dimensional feature space of z-scores:

- **Calm**: Low-stress cluster (generally PXI < 0)
- **Normal**: Moderate-stress cluster (generally -1 < PXI < 1)
- **Stress**: High-stress cluster (generally PXI > 1)

Regime boundaries are **data-driven** rather than fixed thresholds, allowing the system to adapt to evolving market dynamics.

---

## Validation & Acceptance Criteria

### Z-Score Accuracy
- Manual recomputation of z-scores must match stored values within **≤1e-6** tolerance
- All z-scores must be finite (no NaN or Infinity)

### Composite Integrity
- Manual PXI recomputation must match stored value within **≤0.001** tolerance
- Total weight sum: **11.2** (excluding zero-weight metrics)

### Sanity Checks
- PXI must fall within reasonable range: **-10 < PXI < 10**
- Individual z-scores should generally be within **-5 < z < 5**
- VIX and HY OAS should show positive correlation (both rise during stress)

### Data Integrity
- No duplicate timestamps for same metric
- No NULL z-scores or PXI values in last 7 days
- Latest data age < 7 days

---

## Data Sources

All metrics are sourced from authoritative, publicly available data providers:

- **FRED (Federal Reserve Economic Data)**: 9 metrics
- **CoinGecko API**: 1 metric (BTC)

Data is ingested daily via automated workers and stored in TimescaleDB hypertables for efficient time-series queries.

---

## Historical Context

PXI is designed to capture systemic stress across multiple dimensions:

1. **Credit markets** (HY OAS, IG OAS)
2. **Equity volatility** (VIX)
3. **Labor markets** (Unemployment)
4. **Monetary conditions** (USD, NFCI, STLFSI)
5. **Yield curve dynamics** (10y-2y slope)
6. **Risk appetite** (BTC returns)
7. **Inflation expectations** (Breakeven, display-only)

By combining these diverse signals, PXI provides a holistic view of market stress that transcends any single asset class or indicator.

---

## Technical Implementation

### Database Schema
- **Table:** `pxi_metric_samples`
  - Stores raw values and z-scores for each metric
  - Hypertable partitioned by `source_timestamp`
- **Table:** `composite_pxi_regime`
  - Stores final PXI values and timestamps
- **Table:** `pxi_regimes`
  - Stores k-means regime classifications

### Calculation Pipeline
1. **Ingestion:** Daily data fetch from FRED/CoinGecko
2. **Z-Score Computation:** Rolling 90-day window
3. **PXI Aggregation:** Weighted composite calculation
4. **Regime Detection:** K-means clustering on z-score features
5. **Storage:** TimescaleDB hypertables
6. **API:** Real-time serving via Fastify REST endpoints

### Validation
- **Unit Tests:** `tests/pxi_validation.test.ts` (Vitest)
- **Reporting Script:** `scripts/validate-pxi.ts` (daily validation logs)
- **Acceptance Criteria:** Automated checks in CI/CD pipeline

---

## References

- FRED (Federal Reserve Economic Data): https://fred.stlouisfed.org
- CoinGecko API: https://www.coingecko.com/api
- TimescaleDB Documentation: https://docs.timescale.com
- K-Means Clustering (scikit-learn): https://scikit-learn.org/stable/modules/clustering.html#k-means

---

## Version History

- **v1.0** (2024-11): Initial PXI implementation with 10 metrics
- **v1.5** (2024-11): Added k-means regime detection, historical overlays, and backtesting

---

## Contact

For questions or feedback regarding PXI methodology:
- Review codebase at `/Users/scottdhughes/PAMP-WATCH-PXI`
- File issues in project repository
- Consult `/docs` for additional documentation
