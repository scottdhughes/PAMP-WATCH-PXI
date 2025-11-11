/**
 * Generic fetcher utility for API calls with React Query
 */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${url} (${res.status} ${res.statusText})`);
  }
  return res.json();
}
