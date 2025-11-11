/**
 * Technical Indicators Utility
 *
 * Calculates RSI, MACD, and signal multipliers for BTC and other metrics
 */

import { RSI, MACD } from 'technicalindicators';
import { logger } from '../logger.js';

/**
 * Calculate RSI (Relative Strength Index)
 *
 * @param prices - Array of closing prices
 * @param period - RSI period (default: 14)
 * @returns RSI value (0-100) or null if insufficient data
 */
export function calculateRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) {
    logger.warn({ pricesCount: prices.length, required: period + 1 }, 'Insufficient data for RSI calculation');
    return null;
  }

  try {
    const rsiValues = RSI.calculate({ values: prices, period });
    return rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;
  } catch (error) {
    logger.error({ error }, 'Failed to calculate RSI');
    return null;
  }
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * @param prices - Array of closing prices
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal line period (default: 9)
 * @returns MACD object or null if insufficient data
 */
export function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  MACD: number;
  signal: number;
  histogram: number;
} | null {
  const minRequired = slowPeriod + signalPeriod;
  if (prices.length < minRequired) {
    logger.warn(
      { pricesCount: prices.length, required: minRequired },
      'Insufficient data for MACD calculation',
    );
    return null;
  }

  try {
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
  } catch (error) {
    logger.error({ error }, 'Failed to calculate MACD');
    return null;
  }
}

/**
 * Calculate signal multiplier based on RSI and MACD
 *
 * This multiplier adjusts the weight of the BTC metric based on technical indicators:
 * - RSI > 70 (overbought): Increases weight (risk-on signal)
 * - RSI < 30 (oversold): Decreases weight (risk-off signal)
 * - MACD above signal: Bullish bias (increases weight)
 * - MACD below signal: Bearish bias (decreases weight)
 *
 * @param rsi - RSI value (0-100)
 * @param macd - MACD object
 * @returns Signal multiplier (0.8 - 1.2)
 */
export function calculateSignalMultiplier(
  rsi: number | null,
  macd: { MACD: number; signal: number; histogram: number } | null,
): number {
  let multiplier = 1.0;

  // RSI component (±10%)
  if (rsi !== null) {
    if (rsi > 70) {
      // Overbought - increase weight slightly (frothy market = more stress signal)
      const rsiComponent = 1 + ((rsi - 70) / 30) * 0.1;
      multiplier *= Math.min(rsiComponent, 1.1);
    } else if (rsi < 30) {
      // Oversold - decrease weight (extreme fear = less reliable signal)
      const rsiComponent = 1 - ((30 - rsi) / 30) * 0.1;
      multiplier *= Math.max(rsiComponent, 0.9);
    }
  }

  // MACD component (±10%)
  if (macd !== null) {
    // Bullish crossover (MACD > signal) = increase weight
    // Bearish crossover (MACD < signal) = decrease weight
    if (macd.MACD > macd.signal) {
      multiplier *= 1.1;
    } else if (macd.MACD < macd.signal) {
      multiplier *= 0.9;
    }
  }

  // Clamp to reasonable range (0.8 - 1.2 = ±20%)
  return Math.max(0.8, Math.min(1.2, multiplier));
}

/**
 * Normalize RSI to 0-1 range
 */
export function normalizeRSI(rsi: number): number {
  return Math.max(0, Math.min(1, rsi / 100));
}
