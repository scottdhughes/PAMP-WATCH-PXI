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

/**
 * Exponential smoothing for time series data
 * Reduces noise while preserving trend
 *
 * @param data - Time series data
 * @param alpha - Smoothing factor (0-1), default 0.3
 * @returns Smoothed series
 */
export function exponentialSmoothing(data: number[], alpha: number = 0.3): number[] {
  if (data.length === 0) return [];
  if (alpha < 0 || alpha > 1) {
    throw new Error('Alpha must be between 0 and 1');
  }

  const smoothed = [data[0]];
  for (let i = 1; i < data.length; i++) {
    smoothed.push(alpha * data[i] + (1 - alpha) * smoothed[i - 1]);
  }
  return smoothed;
}

/**
 * Linear regression forecast with confidence intervals
 *
 * @param history - Historical time series data
 * @param horizon - Number of periods to forecast
 * @returns Forecast values with confidence intervals
 */
export function forecastLinear(
  history: number[],
  horizon: number
): {
  forecast: number[];
  ciLower: number[];
  ciUpper: number[];
  slope: number;
  intercept: number;
} {
  if (history.length < 2) {
    throw new Error('Need at least 2 data points for forecasting');
  }

  // Simple linear regression: y = mx + b
  const n = history.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = history;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate residuals for confidence intervals
  const residuals = y.map((yi, i) => yi - (slope * i + intercept));
  const stdRes = standardDeviation(residuals);
  const confidenceMultiplier = 1.96; // 95% confidence interval

  // Generate forecasts
  const forecast: number[] = [];
  const ciLower: number[] = [];
  const ciUpper: number[] = [];

  for (let i = 0; i < horizon; i++) {
    const step = n + i;
    const pred = slope * step + intercept;
    const conf = confidenceMultiplier * stdRes;

    forecast.push(pred);
    ciLower.push(pred - conf);
    ciUpper.push(pred + conf);
  }

  return { forecast, ciLower, ciUpper, slope, intercept };
}

/**
 * Map PXI value to regime name
 *
 * @param pxi - PXI value
 * @returns Regime name
 */
export function deriveRegime(pxi: number): string {
  if (pxi > 2.0) return 'Strong PAMP';
  if (pxi > 1.0) return 'Moderate PAMP';
  if (pxi >= -1.0) return 'Normal';
  if (pxi >= -2.0) return 'Elevated Stress';
  return 'Crisis';
}

/**
 * Derive regime with confidence probability
 * Confidence is based on how narrow the CI is (narrow = high confidence)
 *
 * @param pxi - Forecasted PXI value
 * @param ciLower - Lower confidence interval
 * @param ciUpper - Upper confidence interval
 * @returns Regime and confidence probability
 */
export function deriveRegimeWithProb(
  pxi: number,
  ciLower: number,
  ciUpper: number
): { regime: string; confidence: number } {
  const regime = deriveRegime(pxi);

  // Confidence based on CI width relative to PXI value
  // Narrower CI = higher confidence
  const ciWidth = ciUpper - ciLower;
  const pxiRange = Math.abs(pxi) + 1; // Add 1 to avoid division by zero
  const confidenceRaw = 1 - Math.min(1, ciWidth / (pxiRange * 4));

  // Ensure confidence is between 0.5 and 1.0
  const confidence = Math.max(0.5, Math.min(1.0, confidenceRaw));

  return { regime, confidence };
}
