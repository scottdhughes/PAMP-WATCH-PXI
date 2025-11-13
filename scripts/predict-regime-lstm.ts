#!/usr/bin/env node
/**
 * LSTM Regime Forecasting Wrapper (Phase 5.2)
 *
 * TypeScript wrapper for Python LSTM predictor. Calls Python script,
 * parses output, stores forecasts to database, and generates JSON report.
 *
 * Usage:
 *   npx tsx scripts/predict-regime-lstm.ts [--horizon=7] [--days=365] [--retrain]
 */

import { spawn } from 'child_process';
import { storeForecast, closePool } from '../db.js';
import { logger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

interface LSTMForecast {
  day: number;
  predictedPxi: number;
  predictedRegime: string;
  confidence: number;
}

interface LSTMOutput {
  timestamp: string;
  method: string;
  model: {
    hidden_size: number;
    num_layers: number;
    sequence_length: number;
  };
  daysAnalyzed: number;
  horizon: number;
  forecasts: LSTMForecast[];
  summary: {
    avgPredictedPxi: number;
    avgConfidence: number;
    regimeDistribution: Record<string, number>;
  };
}

/**
 * Get Python executable path (prefer venv if available)
 */
function getPythonPath(): string {
  const venvPython = path.join(process.cwd(), 'venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return 'python3';
}

/**
 * Check if Python 3 is available
 */
async function checkPythonInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonPath = getPythonPath();
    const python = spawn(pythonPath, ['--version']);

    python.on('close', (code) => {
      resolve(code === 0);
    });

    python.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Check if Python dependencies are installed
 */
async function checkDependenciesInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonPath = getPythonPath();
    const python = spawn(pythonPath, ['-c', 'import torch, numpy, psycopg2; print("OK")']);

    let output = '';
    python.stdout.on('data', (data) => {
      output += data.toString();
    });

    python.on('close', (code) => {
      resolve(code === 0 && output.includes('OK'));
    });

    python.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Run Python LSTM predictor
 */
async function runPythonPredictor(
  horizon: number,
  days: number,
  retrain: boolean
): Promise<LSTMOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      'ml/lstm_predictor.py',
      `--horizon=${horizon}`,
      `--days=${days}`,
    ];

    if (retrain) {
      args.push('--retrain');
    }

    logger.info({ horizon, days, retrain }, 'Launching Python LSTM predictor...');

    const pythonPath = getPythonPath();
    const python = spawn(pythonPath, args, {
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://pxi:pxi123@localhost:5432/pxi',
      },
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        logger.debug({ python_output: line }, 'Python LSTM');
      }
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        logger.error({ code, stderr }, 'Python LSTM predictor failed');
        reject(new Error(`Python script exited with code ${code}\n${stderr}`));
        return;
      }

      try {
        // Parse JSON output from Python script
        const output: LSTMOutput = JSON.parse(stdout);
        logger.info({ forecasts: output.forecasts.length }, 'Python LSTM completed successfully');
        resolve(output);
      } catch (error) {
        logger.error({ error, stdout: stdout.substring(0, 500) }, 'Failed to parse Python output');
        reject(new Error(`Failed to parse Python output: ${error}`));
      }
    });

    python.on('error', (error) => {
      logger.error({ error }, 'Failed to spawn Python process');
      reject(error);
    });
  });
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const startTime = Date.now();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let horizon = 7;
  let days = 365;
  let retrain = false;

  for (const arg of args) {
    if (arg.startsWith('--horizon=')) {
      horizon = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--retrain') {
      retrain = true;
    }
  }

  try {
    // Check Python installation
    logger.info('Checking Python installation...');
    const pythonInstalled = await checkPythonInstalled();

    if (!pythonInstalled) {
      throw new Error(
        'Python 3 is not installed. Install Python 3.8+ from https://www.python.org/'
      );
    }

    // Check dependencies
    logger.info('Checking Python dependencies...');
    const depsInstalled = await checkDependenciesInstalled();

    if (!depsInstalled) {
      throw new Error(
        'Python dependencies not installed. Run: pip3 install -r requirements.txt'
      );
    }

    // Run Python predictor
    const output = await runPythonPredictor(horizon, days, retrain);

    // Store forecasts to database
    logger.info('Storing LSTM forecasts to database...');
    await storeForecast(
      output.forecasts.map((f) => ({
        horizonDays: f.day,
        predictedPxi: f.predictedPxi,
        predictedRegime: f.predictedRegime,
        confidence: f.confidence,
        ciLower: f.predictedPxi - 0.5, // Simplified CI for LSTM
        ciUpper: f.predictedPxi + 0.5,
      })),
      'lstm' // Method parameter
    );

    // Save results to JSON
    const outputDir = path.join(process.cwd(), 'prediction-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `regime-forecast-lstm_${new Date().toISOString().split('T')[0]}.json`;
    const outputPath = path.join(outputDir, filename);

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

    const duration = Date.now() - startTime;
    logger.info(
      {
        duration,
        outputPath,
        avgPredictedPxi: output.summary.avgPredictedPxi.toFixed(4),
      },
      'LSTM regime forecasting completed'
    );

    // Print summary to console
    console.log('\n=== LSTM REGIME FORECAST RESULTS ===\n');
    console.log(`Forecast Date: ${new Date().toISOString().split('T')[0]}`);
    console.log(`Method: LSTM Neural Network`);
    console.log(`Model: ${output.model.num_layers}-layer LSTM, ${output.model.hidden_size} hidden units`);
    console.log(`Historical Data Points: ${output.daysAnalyzed}`);
    console.log(`Forecast Horizon: ${output.horizon} days\n`);

    console.log(`Predictions:`);
    console.log(`  Average Predicted PXI: ${output.summary.avgPredictedPxi.toFixed(4)}`);
    console.log(`  Average Confidence: ${(output.summary.avgConfidence * 100).toFixed(1)}%\n`);

    console.log('Forecasts:');
    output.forecasts.forEach((f) => {
      console.log(
        `  Day ${f.day}: PXI=${f.predictedPxi.toFixed(4)}, ` +
          `Regime="${f.predictedRegime}", ` +
          `Conf=${(f.confidence * 100).toFixed(1)}%`
      );
    });

    console.log('\nRegime Distribution:');
    Object.entries(output.summary.regimeDistribution).forEach(([regime, count]) => {
      const percentage = ((count / horizon) * 100).toFixed(0);
      console.log(`  ${regime}: ${count} days (${percentage}%)`);
    });

    console.log(`\nResults saved to: ${outputPath}\n`);

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.fatal({ error }, 'LSTM regime forecasting failed');
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}\n`);
    await closePool();
    process.exit(1);
  }
}

// Run the predictor
main();
