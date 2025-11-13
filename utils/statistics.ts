/**
 * Statistical utilities for quantitative optimization
 *
 * Provides correlation analysis, descriptive statistics, and optimization helpers
 * for data-driven parameter tuning.
 */

/**
 * Calculate Pearson correlation coefficient between two arrays
 *
 * @param x - First data series
 * @param y - Second data series
 * @returns Correlation coefficient (-1 to 1), or NaN if invalid
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) {
    return NaN;
  }

  const n = x.length;
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let sumXSquared = 0;
  let sumYSquared = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    sumXSquared += dx * dx;
    sumYSquared += dy * dy;
  }

  const denominator = Math.sqrt(sumXSquared * sumYSquared);

  if (denominator === 0) {
    return NaN;
  }

  return numerator / denominator;
}

/**
 * Calculate mean of an array
 *
 * @param values - Array of numbers
 * @returns Mean value
 */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate standard deviation of an array
 *
 * @param values - Array of numbers
 * @returns Standard deviation
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return NaN;
  const avg = mean(values);
  const squareDiffs = values.map((val) => Math.pow(val - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate Sharpe ratio (returns / volatility)
 *
 * @param returns - Array of return values
 * @param riskFreeRate - Risk-free rate (default: 0)
 * @returns Sharpe ratio
 */
export function sharpeRatio(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length === 0) return NaN;
  const excessReturns = returns.map((r) => r - riskFreeRate);
  const avgReturn = mean(excessReturns);
  const volatility = standardDeviation(excessReturns);
  return volatility === 0 ? NaN : avgReturn / volatility;
}

/**
 * Normalize array to z-scores
 *
 * @param values - Array of numbers
 * @returns Array of z-scores
 */
export function normalize(values: number[]): number[] {
  const avg = mean(values);
  const std = standardDeviation(values);
  if (std === 0) return values.map(() => 0);
  return values.map((val) => (val - avg) / std);
}

/**
 * Calculate alignment score between two series
 * Higher score means better alignment (same direction movement)
 *
 * @param x - First series
 * @param y - Second series
 * @returns Alignment score (0 to 1)
 */
export function alignmentScore(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return NaN;

  let agreements = 0;
  let total = 0;

  for (let i = 1; i < x.length; i++) {
    const xChange = x[i] - x[i - 1];
    const yChange = y[i] - y[i - 1];

    // Count when both move in same direction
    if ((xChange > 0 && yChange > 0) || (xChange < 0 && yChange < 0)) {
      agreements++;
    }
    total++;
  }

  return total === 0 ? NaN : agreements / total;
}

/**
 * Calculate regime prediction accuracy
 * Compares predicted regimes to actual regimes
 *
 * @param predicted - Predicted regime values
 * @param actual - Actual regime values
 * @returns Accuracy (0 to 1)
 */
export function regimePredictionAccuracy(
  predicted: string[],
  actual: string[]
): number {
  if (predicted.length !== actual.length || predicted.length === 0) {
    return NaN;
  }

  const correct = predicted.filter((p, i) => p === actual[i]).length;
  return correct / predicted.length;
}
