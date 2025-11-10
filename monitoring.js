import { logger } from './logger.js';
import { config } from './config.js';
export const detectStaleFeeds = (samples) => {
    const now = Date.now();
    samples.forEach((sample) => {
        const age = now - new Date(sample.sourceTimestamp).getTime();
        if (age > config.staleThresholdMs) {
            logger.warn({ sample, age }, 'Feed stale alert');
        }
    });
};
export const recordIngestionFailure = (metricId, error) => {
    logger.error({ metricId, error }, 'Feed failure');
};
