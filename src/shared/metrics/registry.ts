import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One process-wide registry — Node/process defaults (CPU, memory, event
 * loop lag, GC) plus the app-defined metrics below. `shared/` can never
 * import from `modules/*` (`eslint.config.js`'s boundary rule), so the
 * indexer-lag and queue-depth gauges here are deliberately just settable
 * values, not self-updating `collect` callbacks — `app.ts` (the one place
 * allowed to see both `shared` and `module-root`) refreshes them right
 * before each `/metrics` scrape, see `shared/http/routes/metrics.ts`.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

/** `null` lag (contract not yet configured, see `GetIndexerHealthResult`)
 * simply isn't `set()` for that contract — Prometheus gauges have no
 * "unknown" value, and a stale-but-present prior value would be more
 * misleading than the series just not existing yet for that label. */
export const indexerLagLedgers = new Gauge({
  name: 'indexer_lag_ledgers',
  help: 'now_ledger - lastLedgerSeq per tracked contract',
  labelNames: ['contract'],
  registers: [registry],
});

export const queueJobsGauge = new Gauge({
  name: 'queue_jobs',
  help: 'BullMQ job counts per queue and state',
  labelNames: ['queue', 'state'],
  registers: [registry],
});
