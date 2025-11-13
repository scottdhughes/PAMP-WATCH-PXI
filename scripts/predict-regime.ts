#!/usr/bin/env node
/**
 * Regime Forecasting Script (Phase 5.1: Statistical Forecasting)
 *
 * Predicts future PXI values and regime classifications using:
 * 1. Exponential smoothing for trend extraction
 * 2. Linear regression for forecasting
 * 3. Confidence intervals based on historical volatility
 *
 * Outputs forecasts to JSON and database for analysis.
 *
 * Usage:
 *   npx tsx scripts/predict-regime.ts [--horizon=7] [--days=365]
 */

import {
  exponentialSmoothing,
  forecastLinear,
  deriveRegimeWithProb,
  mean,
  standardDeviation,
} from '../utils/statistics.js';
import { fetchHistoricalPxi, storeForecast, closePool } from '../db.js';
import { logger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

interface ForecastResult {
  timestamp: string;
  daysAnalyzed: number;
  horizon: number;
  smoothingAlpha: number;
  forecasts: Array<{
    day: number;
    predictedPxi: number;
    predictedRegime: string;
    confidence: number;
    ciLower: number;
    ciUpper: number;
  }>;
  summary: {
    avgPredictedPxi: number;
    avgConfidence: number;
    trendSlope: number;
    trendDirection: string;
    regimeDistribution: Record<string, number>;
  };
}

/**
 * Main forecasting function
 */
async function predictRegime(
  horizon: number = 7,
  days: number = 365,
  alpha: number = 0.3
): Promise<void> {
  const startTime = Date.now();
  logger.info({ horizon, days, alpha }, 'Starting regime forecasting');

  try {
    // 1. Fetch historical PXI data
    logger.info('Fetching historical PXI data...');
    const historicalPxi = await fetchHistoricalPxi(days);

    if (historicalPxi.length < 10) {
      throw new Error(
        `Insufficient historical data: ${historicalPxi.length} points (need at least 10)`
      );
    }

    logger.info(
      {
        dataPoints: historicalPxi.length,
        latest: historicalPxi[historicalPxi.length - 1].toFixed(4),
        avg: mean(historicalPxi).toFixed(4),
        stdDev: standardDeviation(historicalPxi).toFixed(4),
      },
      'Historical data loaded'
    );

    // 2. Apply exponential smoothing
    logger.info({ alpha }, 'Applying exponential smoothing...');
    const smoothed = exponentialSmoothing(historicalPxi, alpha);

    const volatilityReduction = (
      ((standardDeviation(historicalPxi) - standardDeviation(smoothed)) /
        standardDeviation(historicalPxi)) *
      100
    ).toFixed(1);

    logger.info(
      { volatilityReduction: `${volatilityReduction}%` },
      'Data smoothed successfully'
    );

    // 3. Generate forecasts
    logger.info({ horizon }, 'Generating forecasts...');
    const { forecast, ciLower, ciUpper, slope, intercept } = forecastLinear(smoothed, horizon);

    // 4. Derive regimes with confidence
    const forecasts: ForecastResult['forecasts'] = [];
    const regimeDistribution: Record<string, number> = {};

    for (let i = 0; i < horizon; i++) {
      const { regime, confidence } = deriveRegimeWithProb(forecast[i], ciLower[i], ciUpper[i]);

      forecasts.push({
        day: i + 1,
        predictedPxi: forecast[i],
        predictedRegime: regime,
        confidence,
        ciLower: ciLower[i],
        ciUpper: ciUpper[i],
      });

      // Count regime distribution
      regimeDistribution[regime] = (regimeDistribution[regime] || 0) + 1;

      logger.debug(
        {
          day: i + 1,
          pxi: forecast[i].toFixed(4),
          regime,
          confidence: confidence.toFixed(3),
          ci: `[${ciLower[i].toFixed(4)}, ${ciUpper[i].toFixed(4)}]`,
        },
        'Forecast generated'
      );
    }

    // 5. Calculate summary statistics
    const avgPredictedPxi = mean(forecast);
    const avgConfidence = mean(forecasts.map((f) => f.confidence));
    const trendDirection = slope > 0.01 ? 'Bullish' : slope < -0.01 ? 'Bearish' : 'Neutral';

    const result: ForecastResult = {
      timestamp: new Date().toISOString(),
      daysAnalyzed: historicalPxi.length,
      horizon,
      smoothingAlpha: alpha,
      forecasts,
      summary: {
        avgPredictedPxi,
        avgConfidence,
        trendSlope: slope,
        trendDirection,
        regimeDistribution,
      },
    };

    // 6. Store forecasts in database
    logger.info('Storing forecasts to database...');
    await storeForecast(
      forecasts.map((f) => ({
        horizonDays: f.day,
        predictedPxi: f.predictedPxi,
        predictedRegime: f.predictedRegime,
        confidence: f.confidence,
        ciLower: f.ciLower,
        ciUpper: f.ciUpper,
      }))
    );

    // 7. Save results to JSON
    const outputDir = path.join(process.cwd(), 'prediction-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `regime-forecast_${new Date().toISOString().split('T')[0]}.json`;
    const outputPath = path.join(outputDir, filename);

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        outputPath,
        avgPredictedPxi: avgPredictedPxi.toFixed(4),
        trendDirection,
      },
      'Regime forecasting completed'
    );

    // 8. Print summary to console
    console.log('\n=== REGIME FORECAST RESULTS ===\n');
    console.log(`Forecast Date: ${new Date().toISOString().split('T')[0]}`);
    console.log(`Historical Data Points: ${historicalPxi.length} (last ${days} days)`);
    console.log(`Forecast Horizon: ${horizon} days`);
    console.log(`Smoothing Alpha: ${alpha}`);
    console.log(`Volatility Reduction: ${volatilityReduction}%\n`);

    console.log(`Trend Analysis:`);
    console.log(`  Slope: ${slope.toFixed(6)}`);
    console.log(`  Direction: ${trendDirection}`);
    console.log(`  Average Predicted PXI: ${avgPredictedPxi.toFixed(4)}`);
    console.log(`  Average Confidence: ${(avgConfidence * 100).toFixed(1)}%\n`);

    console.log('Forecasts:');
    forecasts.forEach((f) => {
      console.log(
        `  Day ${f.day}: PXI=${f.predictedPxi.toFixed(4)}, ` +
          `Regime="${f.predictedRegime}", ` +
          `Conf=${(f.confidence * 100).toFixed(1)}%, ` +
          `CI=[${f.ciLower.toFixed(4)}, ${f.ciUpper.toFixed(4)}]`
      );
    });

    console.log('\nRegime Distribution:');
    Object.entries(regimeDistribution).forEach(([regime, count]) => {
      const percentage = ((count / horizon) * 100).toFixed(0);
      console.log(`  ${regime}: ${count} days (${percentage}%)`);
    });

    console.log(`\nResults saved to: ${outputPath}\n`);
  } catch (error) {
    logger.fatal({ error }, 'Regime forecasting failed');
    throw error;
  }
}

/**
 * Entry point
 */
async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let horizon = 7;
  let days = 365;
  let alpha = 0.3;

  for (const arg of args) {
    if (arg.startsWith('--horizon=')) {
      horizon = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--alpha=')) {
      alpha = parseFloat(arg.split('=')[1]);
    }
  }

  try {
    await predictRegime(horizon, days, alpha);
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'Fatal error in regime forecasting');
    await closePool();
    process.exit(1);
  }
}

// Run the predictor
main();
