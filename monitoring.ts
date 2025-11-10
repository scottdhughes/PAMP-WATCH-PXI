import { logger } from './logger.js';
import { config } from './config.js';
import { MetricSample } from './types.js';

export const detectStaleFeeds = (samples: MetricSample[]): void => {
  const now = Date.now();
  samples.forEach((sample) => {
    const age = now - new Date(sample.sourceTimestamp).getTime();
    if (age > config.staleThresholdMs) {
      logger.warn({ sample, age }, 'Feed stale alert');
    }
  });
};

export const recordIngestionFailure = (metricId: string, error: unknown): void => {
  logger.error({ metricId, error }, 'Feed failure');
};
