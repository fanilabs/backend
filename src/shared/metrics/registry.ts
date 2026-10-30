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

export const workerHeartbeatFailuresTotal = new Counter({
  name: 'worker_heartbeat_failures_total',
  help: 'Worker heartbeat file write failures since process start',
  registers: [registry],
});

/**
 * Incremented every time a registered blockchain-event subscriber
 * (`subscribeBlockchainEventHandler`, src/shared/events) fails while handling
 * an event. The catch block that logs the failure used to do nothing else,
 * so read models could drift permanently from on-chain state with no signal
 * for Prometheus/Grafana alert rules — only raw stdout logs (docs/OBSERVABILITY.md).
 * Labels mirror the envelope so an alert can identify what stopped syncing:
 * `contract` (event.contractName), `event` (first topic segment), and
 * `subscriber` (the module's own error-message string, one fixed value per
 * registered handler — deliberately low-cardinality).
 */
export const eventSubscriberErrorsTotal = new Counter({
  name: 'event_subscriber_errors_total',
  help: 'Total blockchain event subscriber handler failures by contract, event and subscriber',
  labelNames: ['contract', 'event', 'subscriber'],
  registers: [registry],
});
