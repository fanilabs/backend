# Observability

## Logging

Structured JSON logging via [Pino](https://getpino.io) (`src/shared/logger/index.ts`), pretty-printed only in `development`. Every log line that matters carries `module` (or `process` for the worker entrypoint) so logs can be filtered by subsystem without grepping message text. Sensitive fields (`authorization`/`cookie` headers, passwords, tokens) are redacted at the logger level — see [`SECURITY.md`](./SECURITY.md).

Fastify's request logging is enabled by default (disabled only in `test` to keep test output readable) and includes request id, method, path, status code, and response time automatically.

## Health Checks

- `GET /health` — database + Redis reachability, `200` when both are `ok`, `503` otherwise (`src/shared/http/routes/health.ts`).
- `GET /health/indexer` — per-contract indexer lag against the real current ledger (queries the live Soroban RPC on every call), `200`/`503` per contract's lag vs. `INDEXER_LAG_ALERT_LEDGERS`. Implemented (`src/modules/indexer`); see [`EVENT_INDEXER.md`](./EVENT_INDEXER.md).
- `GET /health/queue` — per-queue job counts (`waiting`/`active`/`delayed`/`failed`/`completed`) for every monitored BullMQ queue (`blockchain-indexer`, `notifications`). `503 degraded` if any queue has ever produced a job that exhausted all 5 of its retries (`failed > 0`) — unlike the indexer's numeric lag threshold, there's no natural "how many failures are acceptable" number here, so any failure at all is the signal.

## Error Reporting

Every thrown error resolves through the single error hierarchy (`src/shared/errors`) and its Fastify error handler — 5xx errors are logged at `error` level with the full error object; 4xx errors at `warn` level, since they're expected client mistakes, not incidents. This means error volume by `code` (from the `AppError` subclasses) is already a meaningful metric without any extra instrumentation.

## Metrics

`GET /metrics` — Prometheus text format (`prom-client`, `src/shared/metrics/`), unauthenticated and outside `/api/v1` like every other operational endpoint. A real deployment puts this behind network policy (Prometheus scraping), not app-level auth. Exposes:

- Node/process defaults — CPU, memory, event loop lag, GC (`collectDefaultMetrics`).
- `http_requests_total` / `http_request_duration_seconds` — labeled by `method`, `route` (the route *pattern*, e.g. `/api/v1/deliveries/:chainDeliveryId`, never the raw URL — using the raw URL would blow up label cardinality with one series per distinct id ever requested), and `status_code`. Recorded via an `onResponse` hook (`shared/http/plugins/metrics.ts`).
- `indexer_lag_ledgers{contract}` — the same `now_ledger - lastLedgerSeq` `/health/indexer` already computes, mirrored here as a gauge; only set for contracts with a configured id (see "What to Watch in Production" below for why `null` isn't represented as a value).
- `queue_jobs{queue,state}` — the same counts `/health/queue` reports, as a gauge.

`shared/metrics/registry.ts` deliberately holds only settable gauges, not self-updating `collect` callbacks — `shared/` can never import from `modules/*` (`eslint.config.js`'s boundary rule), so `app.ts` (the one place allowed to see both) refreshes the indexer-lag/queue gauges immediately before each scrape (`shared/http/routes/metrics.ts`'s injected `refreshExternalGauges` callback). GMV/dispute-rate-style business metrics (`analytics` module) aren't mirrored here in this v1 slice — they're `ADMIN`-gated business data, not the kind of thing an infra-facing scrape endpoint should expose without its own access control; `GET /api/v1/analytics/*` is the place for those.

**`/metrics` is noticeably slower than every other endpoint** — a real, measured characteristic (see "Load Testing" below), not a bug: `refreshExternalGauges` makes a real Soroban RPC call (`getIndexerLagMetrics` → `getLatestLedger()`) on every single scrape, unlike `GET /health/indexer`'s own equally-real-but-separately-paced call. Fine at a normal Prometheus scrape interval (15–30s, `docker/prometheus.yml`'s default); don't lower the scrape interval far below that or expose this endpoint to unthrottled public traffic without accounting for the extra RPC round-trip it costs per request.

### Dashboards

`docker compose --profile observability up` (`make docker-up-observability`) brings up a local Prometheus (`docker/prometheus.yml`, scraping `api:3000/metrics` every 15s) and Grafana (`docker/grafana/`, auto-provisioned datasource + one starter dashboard, `admin`/`admin` — change before exposing this beyond your own machine) alongside the normal stack. Grafana at `http://localhost:3001`, Prometheus at `http://localhost:9090`. The starter dashboard (`docker/grafana/dashboards/fanilab-backend.json`) has seven panels: HTTP request rate and p95 latency by route, HTTP error rate, indexer lag per contract, queue depth and failed-job count per queue, and process resident memory. Not part of the default `docker compose up` topology (`DEPLOYMENT.md`'s topology is `api`/`worker`/`postgres`/`redis`) — a real deployment scrapes `/metrics` with whatever monitoring stack it already runs; this is for looking at this backend's own metrics locally without standing up external infra first. Verified for real (Phase 6): Prometheus reports the `fanilab-backend-api` scrape target `"health": "up"`, and Grafana's own datasource proxy returns real, non-empty query results for the dashboard's panels — not just "the containers started."

## Load Testing

`pnpm load-test` (`scripts/load-test.ts`, `make load-test`) — `autocannon` against a running instance's public, read-only, no-side-effect endpoints only (`/health`, `/api/v1/deliveries`, a 404 case, `/metrics`); never touches auth/mutating routes, so it's safe to run against any environment without creating data or needing credentials. `BASE_URL` env var to target something other than `localhost:3000`.

Phase 6's verification run, against the real Docker Compose deployment (20 connections, 10s/endpoint, empty database — no seeded business data):

| Endpoint | req/s | p50 / p95 / p99 (ms) |
|---|---|---|
| `GET /health` | 992 | 15 / 55 / 66 |
| `GET /api/v1/deliveries` | 795 | 21 / 58 / 81 |
| `GET /api/v1/deliveries/:unknown-id` (404) | 1180 | 14 / 40 / 48 |
| `GET /metrics` | 104 | 149 / 482 / 599 |

Zero errors, timeouts, or unexpected non-2xx across all four. `/metrics`' outlier latency is the real Soroban RPC round-trip noted above, not database/Redis overhead — the other three endpoints all hit Postgres/Redis and stay well under 100ms at p95.

## Tracing

Not yet implemented. If/when the module count and cross-service call graph (API → indexer → workers → Soroban RPC) makes debugging latency issues hard without it, OpenTelemetry is the natural fit given Fastify's ecosystem support — noted here as a future enhancement, not built ahead of the need.

## What to Watch in Production

The single most important operational signal is **indexer lag** (`GET /health/indexer`, `now_ledger - lastLedgerSeq` per contract) — every other module's read model is only as fresh as the indexer, so lag is the leading indicator for "the API is about to start looking stale," ahead of any user-facing symptom. This mirrors the lesson in `PHASE_2_REFERENCE_ANALYSIS.md` §3 about treating indexer lag as a first-class health signal, not an afterthought. Tracks all five contracts with a consuming module — `escrow_contract`, `delivery_contract`, `fleet_management_contract`, `dispute_resolution_contract`, `identity_reputation_contract` (`EVENT_INDEXER.md` § Current Scope) — a contract with no id configured reports `configured: false` and is excluded from the lag calculation rather than reported as failing. `GET /health/queue`/`queue_jobs`' `failed` count is the second most important — a queue with failed jobs means something needed human attention and BullMQ's own retries already gave up.
