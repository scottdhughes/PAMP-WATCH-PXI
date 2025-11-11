/**
 * Portfolio Analytics Utilities
 *
 * Provides risk and performance metrics for PXI composite index:
 * - Sharpe Ratio: Risk-adjusted return metric
 * - Max Drawdown: Peak-to-trough decline
 * - Volatility: Annualized standard deviation
 */

/**
 * Calculate annualized Sharpe Ratio
 *
 * Formula: (Mean Return - Risk Free Rate) / Std Dev * sqrt(252)
 *
 * @param returns - Array of daily returns (decimal format, e.g., 0.01 for 1%)
 * @param riskFreeRate - Annual risk-free rate (default: 2%)
 * @returns Annualized Sharpe ratio
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate = 0.02,
): number {
  if (!returns.length) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return 0;

  // Annualize: sqrt(252) for daily returns
  const dailyRiskFreeRate = riskFreeRate / 252;
  const sharpe = ((mean - dailyRiskFreeRate) / stddev) * Math.sqrt(252);

  return sharpe;
}

/**
 * Calculate maximum drawdown from peak
 *
 * @param values - Array of PXI values over time
 * @returns Object with maxDrawdown, peak index, and trough index
 */
export function calculateMaxDrawdown(values: number[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  peakIndex: number;
  troughIndex: number;
  peakValue: number;
  troughValue: number;
} {
  if (!values.length) {
    return {
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      peakIndex: 0,
      troughIndex: 0,
      peakValue: 0,
      troughValue: 0,
    };
  }

  let peak = -Infinity;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peakIndex = 0;
  let troughIndex = 0;
  let peakValue = 0;
  let troughValue = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) {
      peak = values[i];
      peakIndex = i;
    }

    const drawdown = peak - values[i];
    const drawdownPercent = peak !== 0 ? drawdown / Math.abs(peak) : 0;

    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
      troughIndex = i;
      peakValue = peak;
      troughValue = values[i];
    }
  }

  return {
    maxDrawdown,
    maxDrawdownPercent,
    peakIndex,
    troughIndex,
    peakValue,
    troughValue,
  };
}

/**
 * Calculate annualized volatility
 *
 * @param returns - Array of daily returns
 * @returns Annualized volatility (standard deviation)
 */
export function calculateVolatility(returns: number[]): number {
  if (!returns.length) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(252) for daily returns
  return stddev * Math.sqrt(252);
}

/**
 * Calculate cumulative returns
 *
 * @param returns - Array of daily returns
 * @returns Cumulative return (e.g., 0.25 for 25% total return)
 */
export function calculateCumulativeReturn(returns: number[]): number {
  if (!returns.length) return 0;

  // Compound returns: (1 + r1) * (1 + r2) * ... - 1
  return returns.reduce((cum, r) => cum * (1 + r), 1) - 1;
}

/**
 * Calculate downside deviation (for Sortino ratio)
 *
 * @param returns - Array of daily returns
 * @param targetReturn - Minimum acceptable return (default: 0)
 * @returns Annualized downside deviation
 */
export function calculateDownsideDeviation(
  returns: number[],
  targetReturn = 0,
): number {
  if (!returns.length) return 0;

  const downsideReturns = returns.filter((r) => r < targetReturn);
  if (!downsideReturns.length) return 0;

  const variance =
    downsideReturns.reduce(
      (a, r) => a + Math.pow(r - targetReturn, 2),
      0,
    ) / downsideReturns.length;

  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Calculate Sortino Ratio (downside risk-adjusted return)
 *
 * @param returns - Array of daily returns
 * @param riskFreeRate - Annual risk-free rate (default: 2%)
 * @returns Annualized Sortino ratio
 */
export function calculateSortinoRatio(
  returns: number[],
  riskFreeRate = 0.02,
): number {
  if (!returns.length) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downsideDeviation = calculateDownsideDeviation(returns, 0);

  if (downsideDeviation === 0) return 0;

  const dailyRiskFreeRate = riskFreeRate / 252;
  return ((mean - dailyRiskFreeRate) / downsideDeviation) * Math.sqrt(252);
}
