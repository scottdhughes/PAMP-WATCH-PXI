import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics();

export const cacheHitCounter = new Counter({
  name: 'pxi_cache_hits_total',
  help: 'Number of cache hits',
});

export const cacheMissCounter = new Counter({
  name: 'pxi_cache_misses_total',
  help: 'Number of cache misses',
});

export const httpRequestDuration = new Histogram({
  name: 'pxi_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export { register };
