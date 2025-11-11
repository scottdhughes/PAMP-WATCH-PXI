/**
 * Simple Backtest Engine with Regime Filtering
 *
 * Supports a basic DSL for testing strategies with regime constraints.
 */

import { pool } from '../db.js';
import { logger } from '../logger.js';

export interface BacktestRule {
  name: string;
  when: {
    pxi?: { gt?: number; lt?: number; gte?: number; lte?: number };
    regime?: string[]; // Filter by regime (e.g., ["Calm", "Stress"])
  };
  action: 'long' | 'short' | 'neutral';
}

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  initialCapital: number;
  rules: BacktestRule[];
}

export interface BacktestResult {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
  trades: number;
  winRate: number;
  regimeBreakdown?: Record<string, {
    trades: number;
    return: number;
    cagr: number;
    sharpe: number;
  }>;
}

interface DataPoint {
  date: string;
  pxiValue: number;
  regime: string | null;
  returns: number; // Daily return (mocked for now)
}

/**
 * Fetch historical PXI and regime data
 */
async function fetchBacktestData(startDate: string, endDate: string): Promise<DataPoint[]> {
  const query = `
    SELECT
      p.date::text,
      p.pxi_value,
      r.regime,
      0.001 as returns  -- Mocked returns for demonstration
    FROM (
      SELECT DISTINCT ON (DATE(timestamp))
        DATE(timestamp) as date,
        pxi_value
      FROM composite_pxi_regime
      WHERE DATE(timestamp) >= $1 AND DATE(timestamp) <= $2
      ORDER BY DATE(timestamp), timestamp DESC
    ) p
    LEFT JOIN pxi_regimes r ON p.date = r.date
    ORDER BY p.date ASC;
  `;

  const result = await pool.query(query, [startDate, endDate]);

  return result.rows.map((row) => ({
    date: row.date,
    pxiValue: Number(row.pxi_value),
    regime: row.regime,
    returns: Number(row.returns),
  }));
}

/**
 * Evaluate rule conditions
 */
function evaluateRule(rule: BacktestRule, point: DataPoint): boolean {
  const { pxi, regime } = rule.when;

  // Check PXI conditions
  if (pxi) {
    if (pxi.gt !== undefined && point.pxiValue <= pxi.gt) return false;
    if (pxi.lt !== undefined && point.pxiValue >= pxi.lt) return false;
    if (pxi.gte !== undefined && point.pxiValue < pxi.gte) return false;
    if (pxi.lte !== undefined && point.pxiValue > pxi.lte) return false;
  }

  // Check regime conditions
  if (regime) {
    if (!point.regime || !regime.includes(point.regime)) return false;
  }

  return true;
}

/**
 * Calculate performance metrics
 */
function calculateMetrics(returns: number[], days: number): { cagr: number; sharpe: number; maxDrawdown: number } {
  if (returns.length === 0) {
    return { cagr: 0, sharpe: 0, maxDrawdown: 0 };
  }

  // Calculate cumulative return
  const cumulativeReturn = returns.reduce((cum, r) => cum * (1 + r), 1) - 1;

  // Annualized return (CAGR)
  const years = days / 365;
  const cagr = years > 0 ? (Math.pow(1 + cumulativeReturn, 1 / years) - 1) * 100 : 0;

  // Sharpe ratio (assuming risk-free rate = 0)
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0; // Annualized

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 1;

  returns.forEach((r) => {
    cumulative *= 1 + r;
    if (cumulative > peak) peak = cumulative;
    const drawdown = (peak - cumulative) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  return { cagr, sharpe, maxDrawdown: maxDrawdown * 100 };
}

/**
 * Run backtest
 */
export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  logger.info({ config }, 'Starting backtest');

  // Fetch data
  const data = await fetchBacktestData(config.startDate, config.endDate);
  logger.info({ dataPoints: data.length }, 'Fetched backtest data');

  if (data.length === 0) {
    throw new Error('No data available for backtest period');
  }

  // Track positions and returns
  const strategyReturns: number[] = [];
  const regimeReturns: Record<string, number[]> = {};
  let trades = 0;
  let wins = 0;

  data.forEach((point, idx) => {
    // Evaluate rules
    let position: 'long' | 'short' | 'neutral' = 'neutral';

    for (const rule of config.rules) {
      if (evaluateRule(rule, point)) {
        position = rule.action;
        break; // First matching rule wins
      }
    }

    // Calculate strategy return based on position
    let strategyReturn = 0;
    if (position === 'long') {
      strategyReturn = point.returns;
      trades++;
      if (point.returns > 0) wins++;
    } else if (position === 'short') {
      strategyReturn = -point.returns;
      trades++;
      if (point.returns < 0) wins++;
    }

    strategyReturns.push(strategyReturn);

    // Track by regime
    if (point.regime) {
      if (!regimeReturns[point.regime]) {
        regimeReturns[point.regime] = [];
      }
      regimeReturns[point.regime].push(strategyReturn);
    }
  });

  // Calculate overall metrics
  const overallMetrics = calculateMetrics(strategyReturns, data.length);
  const totalReturn = strategyReturns.reduce((cum, r) => cum * (1 + r), 1) - 1;

  // Calculate regime breakdown
  const regimeBreakdown: Record<string, any> = {};
  Object.entries(regimeReturns).forEach(([regime, returns]) => {
    const metrics = calculateMetrics(returns, returns.length);
    const regimeTotalReturn = returns.reduce((cum, r) => cum * (1 + r), 1) - 1;

    regimeBreakdown[regime] = {
      trades: returns.filter(r => r !== 0).length,
      return: regimeTotalReturn * 100,
      cagr: metrics.cagr,
      sharpe: metrics.sharpe,
    };
  });

  const result: BacktestResult = {
    totalReturn: totalReturn * 100,
    cagr: overallMetrics.cagr,
    sharpe: overallMetrics.sharpe,
    maxDrawdown: overallMetrics.maxDrawdown,
    trades,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    regimeBreakdown,
  };

  logger.info({ result }, 'Backtest completed');
  return result;
}
