# PXI Phase 1 — Codex Implementation Pack

This document contains atomic, copy-ready implementation prompts for expanding the PXI platform. Each task follows FRED-first principles and includes clear requirements, deliverables, and acceptance criteria.

## Implementation Status

- [ ] 1️⃣ FRED Metrics Expansion (3 metrics)
- [x] 2️⃣ Real-Time Refresh (60s polling) ✅ **COMPLETED**
- [ ] 3️⃣ Regime Detection v1 (k-means)
- [ ] 4️⃣ Backtesting v1 (rule engine)
- [ ] 5️⃣ UX Primitives (deltas, sparklines)

---

## 1️⃣ FRED Metrics Expansion

### 1A. St. Louis Fed Financial Stress Index (STLFSI 2.0)

**Context**: You are updating the PXI platform (TypeScript/Node + Next.js + Postgres).

**Goal**: Add a new FRED-backed metric "St. Louis Fed Financial Stress Index (STLFSI2)".

**Requirements**:
- Use existing FRED client and caching pattern; add series ID constant
- Worker: fetch latest + 10 years history; upsert into `pxi_metric_samples` with `metric_id="stlfsi"`
- Compute zScore using rolling mean/std; define lower/upper bounds from config
- Expose in `/v1/pxi/metrics/latest` and `/v1/pxi/history`
- UI: add card + table row; show delta7D/30D, health, color logic
- Alert rule: `|zScore| >= 2.0` → message "Financial stress elevated"
- Tests: fetcher, zScore calc, API snapshot, UI render non-empty

**Deliverables**:
- [ ] `server/db/worker` updates
- [ ] `shared/types.ts` patch
- [ ] Dashboard component update
- [ ] README line documenting series ID = STLFSI2
- [ ] Tests passing

---

### 1B. 10-Year Breakeven Inflation Rate (T10YIE)

**Goal**: Add FRED metric: 10-Year Breakeven Inflation Rate (series T10YIE).

**Steps**:
- Ingest latest + 10 years to `pxi_metric_samples` with `metric_id="breakeven10y"`
- UI: value formatted with 2 decimals + '%'
- Include in System Internals but exclude from PXI composite weighting (via feature flag)
- Config toggle: include/exclude from weighting
- Tests: data pull, formatting, UI render

**Deliverables**:
- [ ] Worker ingest for T10YIE
- [ ] UI display with percentage formatting
- [ ] Config flag for PXI weighting
- [ ] Tests passing

---

### 1C. Yield Curve Slope (10y – 2y)

**Goal**: Implement Yield Curve Slope metric using FRED DGS10 and DGS2.

**Specs**:
- Worker: fetch both series daily; compute spread = `DGS10 − DGS2`
- Store as `metric_id="yc_10y_2y"`
- UI: card + table row show "Inverted" badge when value < 0
- History endpoint: chart with shaded inversion regions
- Alert when inversion persists ≥ 10 consecutive trading days
- Tests: math accuracy, persistence counter, UI badge

**Deliverables**:
- [ ] Dual series fetcher (DGS10, DGS2)
- [ ] Spread calculation worker
- [ ] Inversion badge UI
- [ ] Chart shading for inversions
- [ ] Persistence alert logic
- [ ] Tests passing

---

## 2️⃣ Real-Time Refresh (60s + Integrity Pipeline)

**Goal**: Implement a 60-second refresh system for atomic UI updates.

### Server
- New `/v1/snapshot` endpoint: returns all dashboard data as one object (versioned with timestamp)
- Include PXI, metrics, alerts, health fields

### Client
- Replace per-widget polling with single 60s fetch
- If version unchanged → skip update; else atomic state update
- Retry/backoff; show "stale (mm:ss)" badge after 3 missed intervals

### Tests
- Version increments
- Atomic render (no partial updates)
- Stale display logic

**Deliverables**:
- [x] `/v1/snapshot` endpoint ✅
- [x] Version tracking system ✅
- [x] Client polling with 60s interval ✅
- [x] Stale indicator UI ✅
- [x] Retry/backoff logic ✅
- [x] Tests passing ✅

---

## 3️⃣ Regime Detection v1 (k-Means on PXI Inputs)

**Goal**: Add Regime Detection v1 using k-means clustering.

### Algorithm
- Build 30-day rolling stats (level, zScore, volatility) for core metrics
- Apply k-means (k=3, seeded) → label clusters Calm/Normal/Stress by average VIX/HY OAS

### Storage / API
- Persist daily regime classification in `pxi_regimes` table
- Endpoints: `/v1/pxi/regime/latest` and `/v1/pxi/regime/history`

### UI
- "Market Regime" badge uses current label
- Historical PXI chart shaded by regime

### Tests
- Stable labeling with seed
- Probabilities sum = 1
- UI color render matches cluster

**Deliverables**:
- [ ] k-means implementation (k=3)
- [ ] `pxi_regimes` table schema
- [ ] Regime calculation worker
- [ ] `/v1/pxi/regime/latest` endpoint
- [ ] `/v1/pxi/regime/history` endpoint
- [ ] Market Regime badge UI
- [ ] Chart shading by regime
- [ ] Tests passing

---

## 4️⃣ Backtesting v1 (Rule Engine)

**Goal**: Implement Backtesting v1 for PXI metrics.

### Core
- New `scripts/backtest-engine.ts`: pure TypeScript vectorized daily backtester
- Input: rule DSL (JSON) → conditions on metric fields (value, zScore, delta7D/30D, regime)
- Action: long/flat; no transaction costs v1

### Outputs
- JSON: CAGR, Sharpe, MaxDD, Vol, WinRate + equity curve + trades
- Endpoint: `POST /v1/backtest/run` (creates async job) + polling
- UI: modal with 3 presets + equity/drawdown charts

### Tests
- Deterministic results for same seed
- Unit math tests, snapshot preset validation

**Deliverables**:
- [ ] `scripts/backtest-engine.ts`
- [ ] Rule DSL parser
- [ ] Performance metrics calculation
- [ ] `POST /v1/backtest/run` endpoint
- [ ] Job status polling
- [ ] Backtest modal UI
- [ ] 3 preset strategies
- [ ] Equity/drawdown charts
- [ ] Tests passing

---

## 5️⃣ UX Primitives (Delta + Mini-History)

**Goal**: Enhance metric visuals with deltas, arrows, and sparklines.

### Delta Arrows + Sparklines
- Server: compute 1d% and 7d% deltas → include in snapshot
- UI: small ▲▼ green/red; mini sparkline (14 obs)
- Accessibility: color-blind palette; tooltips for values

### Mini-History Tooltips
- Server: include last-10 values per metric
- UI: on hover show compact table + copy-to-clipboard
- Tests: sign/color, sparkline render, tooltip format

**Deliverables**:
- [ ] 1d% and 7d% delta calculation
- [ ] Delta arrow component (▲▼)
- [ ] Mini sparkline component (14 points)
- [ ] Color-blind palette
- [ ] Tooltip with last-10 values
- [ ] Copy-to-clipboard functionality
- [ ] Tests passing

---

## ✅ Acceptance Checklist for Phase 1

- [ ] **FRED Metrics**: STLFSI2, T10YIE, Yield Curve Slope live and historical
- [ ] **Real-Time Snapshot**: `/v1/snapshot` endpoint + atomic UI updates
- [ ] **Regime Detection v1**: API + UI integration with chart shading
- [ ] **Backtesting v1**: Engine and modal with 3 presets
- [ ] **Delta arrows, sparklines, mini-history tooltips** in UI
- [ ] **All tests passing**: lint & type checks clean
- [ ] **Documentation**: README updated with new features
- [ ] **Validation**: Nightly validation passing for new metrics

---

## Implementation Policy

- **Data Source**: Use FRED for all Phase 1 data series
- **Non-FRED APIs**: CESI, vol surfaces, policy uncertainty are Phase 2+
- **Testing**: Each feature must include unit + integration tests
- **TypeScript**: All new code must pass `npx tsc --noEmit`
- **Validation**: New metrics must integrate with existing validation system
- **Documentation**: Update README and this codex with implementation notes

---

## Priority Recommendation

**High Impact First**:
1. **Real-Time Refresh** (2️⃣) - Improves UX immediately for existing features
2. **Yield Curve Slope** (1C) - High-signal metric, already have FRED infrastructure
3. **UX Primitives** (5️⃣) - Complements real-time refresh
4. **Regime Detection** (3️⃣) - Adds interpretability layer
5. **Backtesting** (4️⃣) - Advanced feature, requires all above

**Quick Wins**:
- STLFSI2 (1A) - Single FRED series, follows existing pattern
- T10YIE (1B) - Single FRED series, display-only

---

## Notes

- Current system has 7 metrics: HY OAS, IG OAS, VIX, U-3, USD, NFCI, BTC
- Validation system already supports outlier detection, correlation analysis
- Scheduler runs data pipeline every minute + validation nightly at 2 AM
- Health status system tracks: OK, Outlier, Flat, Invalid, Stale
