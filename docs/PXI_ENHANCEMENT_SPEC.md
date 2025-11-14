# PXI Engine Enhancement Specification
**Project:** AIXE Capital – Portfolio Cross-Indicator (PXI) System
**Version:** 1.0
**Date:** 2025-11-10
**Author:** Quant Ops, AIXE Capital

---

## 1. Overview
This document defines the enhancements to the PXI monitoring system. We assume **live data only** (no manually guessed values) and build in historical context, dynamic weighting, and alerting.

### 1.1 Objectives
- Incorporate long-term historical context (rolling 10-year statistics) for each indicator.
- Apply dynamic weights when indicators deviate from norm.
- Flag significant deviations & regime shifts automatically.
- Maintain transparency, governance & auditability of the model.

### 1.2 Scope
- Indicators: HY OAS, IG OAS, VIX, U-3 Unemployment, USD Index (Broad), NFCI, BTC Daily Return.
- Data ingestion: live/near real-time.
- Storage: Time-series database / structured table.
- Outputs: z-scores, contributions, composite PXI, regime classification, alert flags.

---

## 2. Data Architecture & Storage

### 2.1 Live Feed
- For each indicator: ingest `raw_value` at timestamp `t`.
- Example schema:

```sql
CREATE TABLE live_values (
  indicator_name VARCHAR,
  timestamp      TIMESTAMP,
  raw_value      FLOAT
);
```

### 2.2 Historical Archive
- Maintain rolling window (W = ~10 years) of past values per indicator.
- Example schema:

```sql
CREATE TABLE history_values (
  indicator_name VARCHAR,
  date           DATE,
  raw_value      FLOAT,
  PRIMARY KEY (indicator_name, date)
);
```

### 2.3 Summary Statistics
- Maintain daily computed stats: mean (μ) and std dev (σ) for each indicator over the rolling window.

```sql
CREATE TABLE stats_values (
  indicator_name VARCHAR,
  date           DATE,
  mean_value     FLOAT,
  stddev_value   FLOAT,
  PRIMARY KEY (indicator_name, date)
);
```

---

## 3. Rolling Z-Score Calculation

- Window length W ≈ 10 years (~2,520 trading days or equivalent).
- On each new update:

```
μₜ = (1/W) Σ xᵢ  (for i = t-W+1 to t)
σₜ = √[(1/(W-1)) Σ (xᵢ - μₜ)²]
```

- Compute z-score:

```
Zₜ = (xₜ - μₜ) / σₜ
```

- Store:

```sql
CREATE TABLE z_scores (
  indicator_name VARCHAR,
  timestamp      TIMESTAMP,
  raw_value      FLOAT,
  z_score        FLOAT,
  PRIMARY KEY (indicator_name, timestamp)
);
```

---

## 4. Weighting & Contribution Logic

### 4.1 Base Weights

Assign each indicator a w_base_i. Example table:

| Indicator           | w_base |
|---------------------|--------|
| HY OAS             | 0.20   |
| IG OAS             | 0.15   |
| VIX                | 0.15   |
| U-3 Unemployment   | 0.10   |
| USD Index (Broad)  | 0.10   |
| NFCI               | 0.20   |
| BTC Daily Return   | 0.10   |

(Total = 1.00)

### 4.2 Dynamic Weight Rule

- If |Zᵢ,ₜ| > 1.0: wᵢ,ₜ = w_base_i × α (e.g., α = 1.5)
- If |Zᵢ,ₜ| > 2.0: wᵢ,ₜ = w_base_i × β (e.g., β = 2.0)
- Else: wᵢ,ₜ = w_base_i

### 4.3 Contribution Computation

```
Cᵢ,ₜ = wᵢ,ₜ × Zᵢ,ₜ
```

Store:

```sql
CREATE TABLE contributions (
  indicator_name VARCHAR,
  timestamp      TIMESTAMP,
  z_score        FLOAT,
  weight_used    FLOAT,
  contribution   FLOAT,
  PRIMARY KEY (indicator_name, timestamp)
);
```

---

## 5. Composite PXI Calculation & Regime Classification

### 5.1 Composite

```
PXIₜ = Σ Cᵢ,ₜ
```

### 5.2 Regime Bands

- **Normal**: |PXIₜ| ≤ 1.0
- **Elevated Stress**: 1.0 < |PXIₜ| ≤ 2.0
- **Crisis / Large Stress**: |PXIₜ| > 2.0

Store composite:

```sql
CREATE TABLE composite_pxi (
  timestamp TIMESTAMP PRIMARY KEY,
  pxi_value FLOAT,
  regime    VARCHAR(32)
);
```

---

## 6. Bounds/Threshold Review & Adjustment Logic

- Store static "normal bounds" per indicator (e.g., ±2σ historically).
- On each update:
  - If |xₜ - xₜ₋₁| / xₜ₋₁ > 0.10 (10% deviation) OR |Zᵢ,ₜ| > threshold ⇒ flag for review.
  - Do not auto-adjust bounds without human oversight.
  - After review, analyst may recalibrate window (W), weights, bounds.

---

## 7. Warning/Alert System

### 7.1 Alert Conditions

- If |Zᵢ,ₜ| > 1.5 for any major indicator → issue alert.
- If |PXIₜ| > 1.0 and |PXIₜ - PXIₜ₋₁| > 0.5 → issue alert.
- If raw value deviates >10% from prior or model assumption → issue alert.

### 7.2 Alert Payload

Include: indicator_name (or "PXI composite"), timestamp, raw_value, z_score (if applicable), weight, contribution, explanation text.

```sql
CREATE TABLE alerts (
  id             BIGSERIAL PRIMARY KEY,
  alert_type     VARCHAR(50),
  indicator_name VARCHAR(50),
  timestamp      TIMESTAMP,
  raw_value      FLOAT,
  z_score        FLOAT,
  weight         FLOAT,
  contribution   FLOAT,
  message        TEXT,
  severity       VARCHAR(20),
  acknowledged   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT NOW()
);
```

### 7.3 Logging / Notification

- Log alert into alerts table.
- Trigger downstream workflows (email, dashboard badge, slack alert).

---

## 8. Pseudocode

```python
for new_point in live_feed:
    indicator = new_point.indicator_name
    t         = new_point.timestamp
    x_t       = new_point.raw_value

    # update history
    history[indicator].append(x_t)
    if len(history[indicator]) > W:
        history[indicator].pop(0)

    mu_t    = mean(history[indicator])
    sigma_t = std_dev(history[indicator])

    Z = (x_t - mu_t) / sigma_t if sigma_t > 0 else 0

    w_base = weights[indicator]
    if abs(Z) > 2.0:
        w = w_base * beta
    elif abs(Z) > 1.0:
        w = w_base * alpha
    else:
        w = w_base

    contribution = w * Z
    log_indicator(indicator, t, x_t, Z, w, contribution)
    contributions[indicator] = contribution

PXI_t = sum(contributions.values())
regime = classify_regime(PXI_t)

log_composite(t, PXI_t, regime)

# review bounds
if abs(x_t - prev_raw[indicator]) / prev_raw[indicator] > 0.10:
    flag_for_review(indicator, t, x_t, prev_raw[indicator])

# warnings
if abs(Z) > 1.5:
    send_alert(indicator, t, x_t, Z, contribution, "High deviation")

if abs(PXI_t) > 1.0 and abs(PXI_t - prev_PXI) > 0.5:
    send_alert("PXI composite", t, PXI_t, None, None, "Composite jump")

prev_raw[indicator] = x_t
prev_PXI = PXI_t
```

---

## 9. Operational Notes & Governance

- Data feed integrity is critical: validate tickers, fix missing values.
- Define schedule: update cycle (daily EOD), recalibration review quarterly.
- Back-test different parameter sets (window length W, α, β, thresholds) and evaluate model sensitivity.
- Maintain audit trail: changes to weights, recalibrations, regime shifts should be documented.
- Dashboard should show: current raw values, z-scores, weights, contributions, PXI composite, regime label, alerts.

---

## 10. Implementation Status

### Phase 1: Historical Data & Z-Scores ⏳
- [ ] Database migrations for historical tables
- [ ] Historical data backfill script (10 years from FRED)
- [ ] Update compute worker for statistical z-scores
- [ ] Calculate rolling mean and stddev

### Phase 2: Dynamic Weighting 📊
- [ ] Implement α=1.5 for |z| > 1.0
- [ ] Implement β=2.0 for |z| > 2.0
- [ ] Update contribution calculations

### Phase 3: Alert System 🚨
- [ ] Alert table and storage
- [ ] Alert condition detection
- [ ] Alert logging and notification system
- [ ] Dashboard alert badges

### Phase 4: Bounds Review & Governance 📋
- [ ] 10% deviation detection
- [ ] Flag for review mechanism
- [ ] Audit trail logging
- [ ] Recalibration workflows

---

## 11. Revision Log

| Version | Date       | Changes                           |
|---------|------------|-----------------------------------|
| 1.0     | 2025-11-10 | Initial spec release             |
| 1.1     | 2025-11-10 | Added implementation status      |

---

**Status:** Implementation in progress
**Next Review:** After Phase 1 completion
