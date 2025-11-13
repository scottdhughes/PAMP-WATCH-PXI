import { config } from '../config.js';
import { getCached, setCached } from '../utils/cache.js';
import { logger } from '../logger.js';

/**
 * Response type from FRED API
 */
interface FredObservationResponse {
  observations: Array<{
    date: string;
    value: string;
  }>;
}

/**
 * Fetches the latest observation for a FRED series with caching and retry logic
 *
 * Caches responses for configurable TTL (default 2 hours) to reduce API calls,
 * improve performance, and handle transient API outages.
 *
 * For monthly metrics (like UNRATE), fetches multiple observations and looks back
 * to find the most recent valid value, since releases can be delayed.
 *
 * @param seriesId - FRED series identifier
 * @param retries - Number of retry attempts (default: 3)
 * @param lookbackLimit - Number of observations to fetch for finding valid data (default: 1, use 12 for monthly)
 * @returns Value and timestamp of the latest observation
 * @throws Error if the request fails after all retries
 */
export const fetchLatestFredObservation = async (
  seriesId: string,
  retries = 3,
  lookbackLimit = 1,
): Promise<{ value: number; timestamp: string }> => {
  // Check cache first
  const cacheKey = `fred:latest:${seriesId}`;
  const cached = getCached(cacheKey);
  if (cached) {
    logger.debug({ seriesId, cacheKey }, 'FRED cache hit');
    return cached;
  }

  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', config.fredApiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(lookbackLimit));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`FRED request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as FredObservationResponse;

      // Iterate through observations to find first valid value
      // This is important for monthly metrics where recent releases may be delayed
      for (const observation of json.observations) {
        if (observation && observation.value !== '.') {
          const result = {
            value: Number(observation.value),
            timestamp: new Date(`${observation.date}T00:00:00Z`).toISOString(),
          };

          // Cache successful response
          setCached(cacheKey, result, config.fredCacheTtl);
          logger.debug(
            { seriesId, cacheKey, ttl: config.fredCacheTtl, observationDate: observation.date },
            'FRED response cached'
          );

          return result;
        }
      }

      // If we get here, no valid observations were found
      throw new Error(`No valid observation found for series ${seriesId} in ${lookbackLimit} recent observations`);
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`FRED fetch failed after ${retries + 1} attempts: ${lastError?.message}`);
};
