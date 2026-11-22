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

## Metrics

`GET /metrics` — Prometheus text format (`prom-client`, `src/shared/metrics/`), unauthenticated and outside `/api/v1` like every other operational endpoint. A real deployment puts this behind network policy (Prometheus scraping), not app-level auth. Exposes:

- Node/process defaults — CPU, memory, event loop lag, GC (`collectDefaultMetrics`).
- `http_requests_total` / `http_request_duration_seconds` — labeled by `method`, `route` (the route *pattern*, e.g. `/api/v1/deliveries/:chainDeliveryId`, never the raw URL — using the raw URL would blow up label cardinality with one series per distinct id ever requested), and `status_code`. Recorded via an `onResponse` hook (`shared/http/plugins/metrics.ts`).
- `indexer_lag_ledgers{contract}` — the same `now_ledger - lastLedgerSeq` `/health/indexer` already computes, mirrored here as a gauge; only set for contracts with a configured id (see "What to Watch in Production" below for why `null` isn't represented as a value).
- `queue_jobs{queue,state}` — the same counts `/health/queue` reports, as a gauge.
- `event_subscriber_errors_total{contract,event,subscriber}` — every exception thrown by a blockchain-event subscriber (`subscribeBlockchainEventHandler`, `src/shared/events`), labeled with the envelope's contract and first topic segment plus the subscriber's fixed error-message string. This is the alert signal for a read model silently drifting from on-chain state: the failure is logged *and* counted here, so an alert rule on this counter fires instead of requiring someone to grep container stdout (`docs/EVENT_INDEXER.md`).

`shared/metrics/registry.ts` deliberately holds only settable gauges, not self-updating `collect` callbacks — `shared/` can never import from `modules/*` (`eslint.config.js`'s boundary rule), so `app.ts` (the one place allowed to see both) refreshes the indexer-lag/queue gauges immediately before each scrape (`shared/http/routes/metrics.ts`'s injected `refreshExternalGauges` callback). GMV/dispute-rate-style business metrics (`analytics` module) aren't mirrored here in this v1 slice — they're `ADMIN`-gated business data, not the kind of thing an infra-facing scrape endpoint should expose without its own access control; `GET /api/v1/analytics/*` is the place for those.

**`/metrics` is noticeably slower than every other endpoint** — a real, measured characteristic (see "Load Testing" below), not a bug: `refreshExternalGauges` makes a real Soroban RPC call (`getIndexerLagMetrics` → `getLatestLedger()`) on every single scrape, unlike `GET /health/indexer`'s own equally-real-but-separately-paced call. Fine at a normal Prometheus scrape interval (15–30s, `docker/prometheus.yml`'s default); don't lower the scrape interval far below that or expose this endpoint to unthrottled public traffic without accounting for the extra RPC round-trip it costs per request.

### Dashboards

`docker compose --profile observability up` (`make docker-up-observability`) brings up a local Prometheus (`docker/prometheus.yml`, scraping `api:3000/metrics` every 15s) and Grafana (`docker/grafana/`, auto-provisioned datasource + one starter dashboard, `admin`/`admin` — change before exposing this beyond your own machine) alongside the normal stack. Grafana at `http://localhost:3001`, Prometheus at `http://localhost:9090`. The starter dashboard (`docker/grafana/dashboards/fanilab-backend.json`) has eight panels: HTTP request rate and p95 latency by route, HTTP error rate, indexer lag per contract, queue depth and failed-job count per queue, process resident memory, and subscriber failure rate by contract/event/subscriber. The subscriber panel charts `increase(event_subscriber_errors_total[5m])` grouped by `contract`, `event`, and `subscriber` — `increase()` is reset-aware, so a counter reset (e.g. a restart) never shows up as a negative failure count, and a quiet deployment with no subscriber exceptions simply shows no series ("No subscriber failures in the selected range") rather than an active incident. Not part of the default `docker compose up` topology (`DEPLOYMENT.md`'s topology is `api`/`worker`/`postgres`/`redis`) — a real deployment scrapes `/metrics` with whatever monitoring stack it already runs; this is for looking at this backend's own metrics locally without standing up external infra first. Verified for real (Phase 6): Prometheus reports the `fanilab-backend-api` scrape target `"health": "up"`, and Grafana's own datasource proxy returns real, non-empty query results for the dashboard's panels — not just "the containers started."

### Troubleshooting an Empty or Zero Panel

An empty panel and a real zero value mean different things. Before concluding the backend is healthy or broken, walk this read-only sequence in order — it checks scrape availability *before* interpreting any business metric.

1. **Is the target being scraped?** Check `up{job="fanilab-backend-api"}` in Prometheus (or the dashboard's datasource). `up == 1` means scrapes are succeeding; `up == 0` or no `up` series at all means the scrape itself is failing or the target isn't configured — fix that first, since every other panel is meaningless until it's resolved. `FanilabApiTargetDown` (`docker/prometheus/alerts.yml`) fires on `up == 0` for `2m`.
2. **Does the metric exist at all?** Confirm the series is present in the selected time range, independent of its value:
   ```promql
   count(indexer_lag_ledgers)          # number of lag series present
   count(http_requests_total)          # number of request series present
   ```
   A `count()` of `0` (or an empty result) means *no samples* — the metric was never observed in that range, which is different from a sample whose value is `0`.
3. **Is it absent or actually zero?** Distinguish the two explicitly:
   ```promql
   absent(indexer_lag_ledgers)         # 1 when no lag series exist at all
   indexer_lag_ledgers == 0            # only matches a present series whose value is 0
   ```
   `absent(...)` returning `1` means the series is missing; `== 0` matching means a real zero sample was recorded. An empty panel is usually the former, not the latter.
4. **Widen the time range.** Labeled HTTP series (`http_requests_total`, `http_request_duration_seconds`) only appear *after* the first observation for a given `method`/`route`/`status_code` combination. A freshly started instance with no traffic yet shows no HTTP series — that's *no traffic*, not a failed scrape. Confirm with step 1 (`up == 1`) before assuming breakage.

**Missing indexer lag is not zero lag.** `shared/metrics/registry.ts` only sets `indexer_lag_ledgers{contract}` for contracts with a configured id and an available value; a contract with no configured id (or before the first successful RPC read) has *no series*, not a lag of `0`. Treating an absent series as `0` would falsely report a healthy indexer. Use `absent(indexer_lag_ledgers{contract="..."})` to detect the missing case rather than reading an empty panel as "lag is fine."

No-data handling here is purely diagnostic: an empty panel never implies the worker is running or that background execution is enabled — it only means no samples were recorded for that series in the selected range. Confirm worker/queue behavior via `queue_jobs` and the worker's own logs, not by inferring from an empty panel.

### Example Alert Rules

`docker/prometheus/alerts.yml` ships two optional, ready-to-adapt example rules for API availability and server-error signals:

- `FanilabApiTargetDown` — fires when `up{job="fanilab-backend-api"} == 0` for `2m` (scrape loss).
- `FanilabApiHigh5xxRate` — fires when more than 5% of `http_requests_total` are `5xx` over a `5m` window, sustained for `5m`, and only when the request rate is above a small floor so low/no-traffic periods don't fire. 4xx-only traffic never matches the `5xx` selector.

To enable them, add the file to your Prometheus config's `rule_files` (e.g. `rule_files: ["alerts.yml"]` alongside `docker/prometheus.yml`). No notification receiver or paging integration is configured or required — the rules only produce alert state; wire up Alertmanager separately if you want notifications. Attach your own deployment labels (environment, cluster, team) via Prometheus `external_labels` or Alertmanager routing rather than editing the rule logic; the rules only set a `severity` label.

The rules are covered by promtool unit tests in `docker/prometheus/alerts.test.yml` (synthetic series for healthy, down, recovering, sustained-5xx, 4xx-only, and low/no-traffic states). Validate without contacting a real alert receiver:

```sh
promtool check rules docker/prometheus/alerts.yml
promtool test rules docker/prometheus/alerts.test.yml
```

## Load Testing

`pnpm load-test` (`scripts/load-test.ts`, `make load-test`) — `autocannon` against a running instance's public, read-only, no-side-effect endpoints only (`/health`, `/api/v1/deliveries`, a 404 case, `/metrics`); never touches auth/mutating routes, so it's safe to run against any environment without creating data or needing credentials. `BASE_URL` env var to target something other than `localhost:3000`.

Phase
