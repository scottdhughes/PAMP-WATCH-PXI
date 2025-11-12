#!/usr/bin/env tsx
/**
 * Verification Script for Quantitative Calculations
 *
 * Recalculates RSI, MACD, Sharpe, Drawdown, and Volatility
 * to verify correctness of displayed metrics.
 */

import { pool } from '../db.js';
import { RSI, MACD } from 'technicalindicators';
import { logger } from '../logger.js';

// Constants from analytics.ts
const RISK_FREE_RATE = 0.02;
const TRADING_DAYS = 252;

/**
 * Fetch BTC price history (last 35 days for indicators)
 */
async function fetchBtcPriceHistory(days: number): Promise<number[]> {
  const result = await pool.query<{ value: number }>(
    `SELECT value
     FROM pxi_metric_samples
     WHERE metric_id = 'btcReturn'
       AND source_timestamp >= NOW() - INTERVAL '${days} days'
     ORDER BY source_timestamp ASC`
  );

  return result.rows.map(r => r.value);
}

/**
 * Fetch PXI history (last 30 days for Sharpe/Drawdown/Volatility)
 */
async function fetchPxiHistory(days: number): Promise<number[]> {
  const result = await pool.query<{ pxi_value: number }>(
    `SELECT pxi_value
     FROM composite_pxi_regime
     WHERE timestamp >= NOW() - INTERVAL '${days} days'
     ORDER BY timestamp ASC`
  );

  return result.rows.map(r => Number(r.pxi_value));
}

/**
 * Calculate RSI
 */
function calculateRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) {
    return null;
  }

  const rsiValues = RSI.calculate({ values: prices, period });
  return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
}

/**
 * Calculate MACD
 */
function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { MACD: number; signal: number; histogram: number } | null {
  const minRequired = slowPeriod + signalPeriod;
  if (prices.length < minRequired) {
    return null;
  }

  const macdValues = MACD.calculate({
    values: prices,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  if (macdValues.length === 0) return null;

  const latest = macdValues[macdValues.length - 1];
  return {
    MACD: latest.MACD ?? 0,
    signal: latest.signal ?? 0,
    histogram: latest.histogram ?? 0,
  };
}

/**
 * Calculate signal multiplier
 */
function calculateSignalMultiplier(
  rsi: number | null,
  macd: { MACD: number; signal: number; histogram: number } | null
): number {
  let multiplier = 1.0;

  // RSI component (±10%)
  if (rsi !== null) {
    if (rsi > 70) {
      const rsiComponent = 1 + ((rsi - 70) / 30) * 0.1;
      multiplier *= Math.min(rsiComponent, 1.1);
    } else if (rsi < 30) {
      const rsiComponent = 1 - ((30 - rsi) / 30) * 0.1;
      multiplier *= Math.max(rsiComponent, 0.9);
    }
  }

  // MACD component (±10%)
  if (macd !== null) {
    if (macd.MACD > macd.signal) {
      multiplier *= 1.1;
    } else if (macd.MACD < macd.signal) {
      multiplier *= 0.9;
    }
  }

  // Clamp to reasonable range (0.8 - 1.2)
  return Math.max(0.8, Math.min(1.2, multiplier));
}

/**
 * Calculate Sharpe Ratio
 */
function calculateSharpeRatio(values: number[]): number {
  if (values.length < 2) return 0;

  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }

  if (returns.length === 0) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return 0;

  const dailyRiskFreeRate = RISK_FREE_RATE / TRADING_DAYS;
  const sharpe = ((mean - dailyRiskFreeRate) / stddev) * Math.sqrt(TRADING_DAYS);

  return sharpe;
}

/**
 * Calculate Maximum Drawdown in standard deviations
 */
function calculateMaxDrawdown(values: number[]): {
  maxDrawdown: number;
  maxDrawdownSigma: number;
  peakValue: number;
  troughValue: number;
} {
  if (values.length === 0) {
    return { maxDrawdown: 0, maxDrawdownSigma: 0, peakValue: 0, troughValue: 0 };
  }

  // Calculate standard deviation of values
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);

  let peak = -Infinity;
  let maxDrawdown = 0;
  let peakValue = 0;
  let troughValue = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
    }

    const drawdown = peak - values[i];
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      peakValue = peak;
      troughValue = values[i];
    }
  }

  // Convert drawdown to standard deviations
  const maxDrawdownSigma = stddev > 0 ? maxDrawdown / stddev : 0;

  return { maxDrawdown, maxDrawdownSigma, peakValue, troughValue };
}

/**
 * Calculate Volatility (annualized)
 */
function calculateVolatility(values: number[]): number {
  if (values.length < 2) return 0;

  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] - values[i - 1]) / values[i - 1]);
  }

  if (returns.length === 0) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(252)
  return stddev * Math.sqrt(TRADING_DAYS);
}

/**
 * Main verification
 */
async function main() {
  console.log('=== QUANTITATIVE METRICS VERIFICATION ===\n');

  try {
    // 1. Verify RSI, MACD, Multiplier (from BTC prices)
    console.log('Fetching BTC price history (35 days)...');
    const btcPrices = await fetchBtcPriceHistory(35);
    console.log(`✓ Fetched ${btcPrices.length} BTC price samples\n`);

    if (btcPrices.length >= 35) {
      const rsi = calculateRSI(btcPrices, 14);
      const macd = calculateMACD(btcPrices, 12, 26, 9);
      const multiplier = calculateSignalMultiplier(rsi, macd);

      console.log('--- BTC TECHNICAL INDICATORS ---');
      console.log(`RSI (14-day):      ${rsi !== null ? rsi.toFixed(2) : 'N/A'}`);
      console.log(`MACD:              ${macd !== null ? macd.MACD.toFixed(0) : 'N/A'}`);
      console.log(`MACD Signal:       ${macd !== null ? macd.signal.toFixed(2) : 'N/A'}`);
      console.log(`MACD Histogram:    ${macd !== null ? macd.histogram.toFixed(2) : 'N/A'}`);
      console.log(`Signal Multiplier: ${multiplier.toFixed(2)}`);
      console.log();

      // Detailed RSI verification
      if (rsi !== null) {
        console.log('RSI Interpretation:');
        if (rsi > 70) console.log('  → Overbought (>70)');
        else if (rsi < 30) console.log('  → Oversold (<30)');
        else console.log('  → Neutral (30-70)');
        console.log();
      }

      // Detailed MACD verification
      if (macd !== null) {
        console.log('MACD Interpretation:');
        if (macd.MACD > macd.signal) {
          console.log('  → Bullish (MACD > Signal)');
        } else {
          console.log('  → Bearish (MACD < Signal)');
        }
        console.log();
      }
    } else {
      console.log('⚠ Insufficient BTC price data for RSI/MACD calculation\n');
    }

    // 2. Verify Sharpe, Drawdown, Volatility (from PXI values)
    console.log('Fetching PXI history (30 days)...');
    const pxiValues = await fetchPxiHistory(30);
    console.log(`✓ Fetched ${pxiValues.length} PXI samples\n`);

    if (pxiValues.length >= 2) {
      const sharpe = calculateSharpeRatio(pxiValues);
      const drawdown = calculateMaxDrawdown(pxiValues);
      const volatility = calculateVolatility(pxiValues);

      console.log('--- PXI PORTFOLIO METRICS ---');
      console.log(`Sharpe Ratio:      ${sharpe.toFixed(2)}`);
      console.log(`Max Drawdown:      ${drawdown.maxDrawdownSigma.toFixed(2)}σ (${drawdown.maxDrawdown.toFixed(3)} abs)`);
      console.log(`Volatility (ann.): ${(volatility * 100).toFixed(2)}%`);
      console.log();

      console.log('Drawdown Details:');
      console.log(`  Peak:    ${drawdown.peakValue.toFixed(3)}`);
      console.log(`  Trough:  ${drawdown.troughValue.toFixed(3)}`);
      console.log(`  Decline: ${drawdown.maxDrawdown.toFixed(3)}`);
      console.log();

      console.log('Sharpe Interpretation:');
      if (sharpe > 1) console.log('  → Good risk-adjusted returns');
      else if (sharpe > 0) console.log('  → Positive but sub-optimal returns');
      else console.log('  → Negative risk-adjusted returns');
      console.log();
    } else {
      console.log('⚠ Insufficient PXI data for portfolio metrics\n');
    }

    console.log('=== VERIFICATION COMPLETE ===');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Verification failed:', error);
    await pool.end();
    process.exit(1);
  }
}

main();
