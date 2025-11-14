import type { MetricSample, MetricId } from './shared/types.js';
import { logger } from './logger.js';

/**
 * Hard limits for metric validation
 */
const HARD_LIMITS: Record<MetricId, { min: number; max: number }> = {
  hyOas: { min: 0, max: 0.25 },
  igOas: { min: 0, max: 0.1 },
  vix: { min: 5, max: 120 },
  u3: { min: 0.02, max: 0.25 },
  usd: { min: 70, max: 130 },
  nfci: { min: -2, max: 5 },
  btcReturn: { min: -0.5, max: 0.5 },
  yc_10y_2y: { min: -2, max: 4 },
  stlfsi: { min: -2, max: 3 },
  breakeven10y: { min: 0, max: 0.05 },
};

/**
 * Validates metric samples against hard limits and business rules
 *
 * @param samples - Array of metric samples to validate
 * @throws Error if validation fails
 */
export const validateSamples = (samples: MetricSample[]): void => {
  // Log all sample values for debugging
  logger.info({ samples: samples.map(s => ({ id: s.id, value: s.value })) }, 'Validating samples');

  samples.forEach((sample) => {
    const limits = HARD_LIMITS[sample.id];
    if (!limits) {
      logger.warn({ metricId: sample.id }, 'No validation limits defined for metric');
      return;
    }

    if (Number.isNaN(sample.value)) {
      const error = `Metric ${sample.id} produced NaN`;
      logger.error({ metricId: sample.id }, error);
      throw new Error(error);
    }

    if (sample.value < limits.min || sample.value > limits.max) {
      const error = `Metric ${sample.id} value ${sample.value} fell outside limits [${limits.min}, ${limits.max}]`;
      logger.error({ metricId: sample.id, value: sample.value, limits }, error);
      throw new Error(error);
    }
  });

  // Business rule: HY spread must exceed IG spread
  const hy = samples.find((s) => s.id === 'hyOas');
  const ig = samples.find((s) => s.id === 'igOas');
  if (hy && ig && hy.value <= ig.value) {
    const error = `HY OAS (${hy.value}) must exceed IG OAS (${ig.value})`;
    logger.error({ hyValue: hy.value, igValue: ig.value }, error);
    throw new Error(error);
  }

  logger.info({ count: samples.length }, 'All samples validated successfully');
};
