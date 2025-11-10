import { config } from '../config.js';

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
 * Fetches the latest observation for a FRED series with retry logic
 *
 * @param seriesId - FRED series identifier
 * @param retries - Number of retry attempts (default: 3)
 * @returns Value and timestamp of the latest observation
 * @throws Error if the request fails after all retries
 */
export const fetchLatestFredObservation = async (
  seriesId: string,
  retries = 3,
): Promise<{ value: number; timestamp: string }> => {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', config.fredApiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '1');

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`FRED request failed: ${response.status} ${response.statusText}`);
      }
      const json = (await response.json()) as FredObservationResponse;
      const observation = json.observations[0];
      if (!observation || observation.value === '.') {
        throw new Error(`No observation found for series ${seriesId}`);
      }
      return {
        value: Number(observation.value),
        timestamp: new Date(`${observation.date}T00:00:00Z`).toISOString(),
      };
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
