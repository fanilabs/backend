# Issue 1 — Healthchecks and restart policies for `api`/`worker`

## Problem

`postgres` and `redis` declared Docker healthchecks and were depended on with
`condition: service_healthy`. `api` and `worker` declared neither a
healthcheck nor a restart policy, even though the application ships
purpose-built readiness probes (`GET /health`). `docker compose ps` reported
`api` as running the moment the process started, before it could serve
traffic, and a wedged `worker` — the process running the entire indexer —
stayed down until someone noticed.

## What changed

- **`Dockerfile`** — added a `HEALTHCHECK` to the `api` stage that calls
  `GET /health` via `node -e "fetch(...)"` (no extra runtime dependency
  needed). The `worker` stage has no HTTP surface, so it got a heartbeat-file
  based `HEALTHCHECK` instead.
- **`src/workers/index.ts`** — the worker process now touches
  `/var/lib/fanilab/heartbeat/worker.heartbeat` every 15 seconds for the
  whole lifetime of the process (cleared on graceful shutdown). The
  `Dockerfile`/compose healthchecks fail if that file goes stale for more
  than 45 seconds, catching a hung or event-loop-blocked worker, not just a
  crashed one.
- **`docker-compose.yml`** — `api` and `worker` both got a matching
  `healthcheck:` and `restart: unless-stopped`. The `observability` profile's
  `prometheus` and `grafana` services now `depends_on: api:` with
  `condition: service_healthy` instead of an unconditional `depends_on`, so
  they don't start scraping/rendering against an API that isn't listening
  yet.
- **`docs/DEPLOYMENT.md`** — documented all of the above under
  § Health Checks.

## Verification

Not run in this change (see repo instructions for this batch of fixes) —
manually verify with:

```bash
docker compose up -d
docker compose ps            # api/worker should report "healthy" once ready
docker kill $(docker compose ps -q worker)   # worker should auto-restart
docker compose --profile observability up -d # should wait for api healthy
```
