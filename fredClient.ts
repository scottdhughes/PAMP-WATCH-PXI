import { config } from '../config.js';

interface FredObservationResponse {
  observations: Array<{
    date: string;
    value: string;
  }>;
}

export const fetchLatestFredObservation = async (
  seriesId: string,
): Promise<{ value: number; timestamp: string }> => {
  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', config.fredApiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '1');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED request failed: ${response.status}`);
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
};
