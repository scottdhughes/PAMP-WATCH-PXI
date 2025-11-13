/**
 * Simple in-memory cache with TTL support
 *
 * Used for caching external API responses (e.g., FRED) to reduce API calls,
 * improve performance, and handle transient API outages.
 *
 * For production with multiple instances, consider upgrading to Redis.
 */

interface CacheEntry {
  value: any;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Retrieve cached value if not expired
 *
 * @param key - Cache key
 * @returns Cached value or null if expired/missing
 */
export function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.value;
  }
  // Clean up expired entry
  cache.delete(key);
  return null;
}

/**
 * Store value in cache with TTL
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds
 */
export function setCached(key: string, value: any, ttlSeconds: number): void {
  const expiry = Date.now() + ttlSeconds * 1000;
  cache.set(key, { value, expiry });
}

/**
 * Clear specific cache entry
 *
 * @param key - Cache key to clear
 */
export function clearCached(key: string): void {
  cache.delete(key);
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 *
 * @returns Cache size and entry count
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
