# Observability

## Logging

Structured JSON logging via [Pino](https://getpino.io) (`src/shared/logger/index.ts`), pretty-printed only in `development`. Every log line that matters carries `module` (or `process` for the worker entrypoint) so logs can be filtered by subsystem without grepping message text. Sensitive fields (`authorization`/`cookie` headers, passwords, tokens) are redacted at the logger level — see [`SECURITY.md`](./SECURITY.md).

Fastify's request logging is enabled by default (disabled only in `test` to keep test output readable) and includes request id, method, path, status code, and response time automatically.

## Health Checks

- `GET /health` — database + Redis reachability, `200` when both are `ok`, `503` otherwise (`src/shared/http/routes/health.ts`).
- `GET /health/indexer` — per-contract indexer lag against the real current ledger (queries the live Soroban RPC on every call), `200`/`503` per contract's lag vs. `INDEXER_LAG_ALERT_LEDGERS`. Implemented (`src/modules/indexer`); see [`EVENT_INDEXER.md`](./EVENT_INDEXER.md).
- `GET /health/queue` — BullMQ queue depth/failure counts, once more background jobs exist beyond the indexer's own polling (Phase 5).

## Error Reporting

Every thrown error resolves through the single error hierarchy (`src/shared/errors`) and its Fastify error handler — 5xx errors are logged at `error` level with the full error object; 4xx errors at `warn` level, since they're expected client mistakes, not incidents. This means error volume by `code` (from the `AppError` subclasses) is already a meaningful metric without any extra instrumentation.

## Metrics (Planned)

Not yet implemented in this scaffold. Planned for Phase 5 alongside the modules that make metrics meaningful (request latency/throughput per route, indexer lag, queue depth/failure rate, dispute rate, GMV — the same aggregate metrics named in `PHASE_1_DOMAIN_ANALYSIS.md` §12 as `analytics` module responsibilities). Candidate approach: Prometheus-format `/metrics` endpoint via a Fastify plugin, scraped by whatever the deployment environment already runs — deferred rather than speculatively built now, per the project's "no placeholder implementations" standard.

## Tracing

Not yet implemented. If/when the module count and cross-service call graph (API → indexer → workers → Soroban RPC) makes debugging latency issues hard without it, OpenTelemetry is the natural fit given Fastify's ecosystem support — noted here as a future enhancement, not built ahead of the need.

## What to Watch in Production

The single most important operational signal is **indexer lag** (`GET /health/indexer`, `now_ledger - lastLedgerSeq` per contract) — every other module's read model is only as fresh as the indexer, so lag is the leading indicator for "the API is about to start looking stale," ahead of any user-facing symptom. This mirrors the lesson in `PHASE_2_REFERENCE_ANALYSIS.md` §3 about treating indexer lag as a first-class health signal, not an afterthought. Currently tracks `escrow_contract` and `delivery_contract` only (`EVENT_INDEXER.md` § Current Scope) — a contract with no id configured reports `configured: false` and is excluded from the lag calculation rather than reported as failing.
