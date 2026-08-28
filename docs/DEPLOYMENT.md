# Deployment

## Topology

Two long-running processes, one shared database, one shared cache/queue broker:

- **`api`** — Fastify HTTP server (`dist/server.js`), stateless, horizontally scalable.
- **`worker`** — BullMQ worker process (`dist/workers/index.js`): the blockchain indexer, notification delivery, and reconciliation jobs. Also horizontally scalable — BullMQ handles job distribution across worker instances.
- **PostgreSQL 16** — primary datastore.
- **Redis 7** — cache + BullMQ broker (two logical connections, see `src/shared/cache` vs `src/shared/queue`, kept separate deliberately).

Both `api` and `worker` are built from the same multi-stage [`Dockerfile`](../Dockerfile) (`api` / `worker` build targets) so there is exactly one build pipeline to maintain, not two diverging images.

## Environments

| Environment | Network | Notes |
|---|---|---|
| Local | testnet | `docker compose up`, see `README.md` |
| Staging | testnet | Mirrors production topology; used to validate against real (but risk-free) Soroban testnet contracts before promotion |
| Production | mainnet | Only stood up once the smart-contract side has completed its own audit/mainnet deployment — this backend does not gate or accelerate that decision (`ROADMAP.md` §11) |

## Release Process

1. Merge to `main` (CI green: lint, typecheck, build, test — see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
2. Tag `vX.Y.Z` (Conventional Commits drive the version bump).
3. [`.github/workflows/release.yml`](../.github/workflows/release.yml) builds and drafts a GitHub Release with auto-generated notes for maintainer review before publishing.
4. Deploy: build/push the `api` and `worker` images, then run migrations as an explicit release step —
   ```bash
   pnpm prisma:migrate:deploy
   ```
   **Never** run `prisma migrate dev` or rely on auto-migration on API boot in a deployed environment — migrations are a deliberate, reviewed step, not a side effect of starting the process.
5. Roll out `api`/`worker` images. Because both are stateless (all state in Postgres/Redis), this supports standard rolling deployment without a maintenance window.

## Configuration

All configuration is environment variables, validated at boot by `src/shared/config/env.ts` (Zod schema) — an invalid or missing required variable fails startup immediately with a clear error, rather than failing on the first request that happens to need it. See [`.env.example`](../.env.example) for the full list.

Contract IDs (`ESCROW_CONTRACT_ID`, etc.) and network settings (`STELLAR_NETWORK`, `SOROBAN_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`) must match the actual deployed `FaniLab-SmartContract` instance for the target environment — cross-check against that repository's deployment output before promoting to a new network.

## Health Checks

- `GET /health` — liveness/readiness: database + Redis reachability (see `src/shared/http/routes/health.ts`).
- `GET /health/indexer` — indexer lag — see [`EVENT_INDEXER.md`](./EVENT_INDEXER.md).
- `GET /health/queue` — BullMQ queue job counts/failures — see [`OBSERVABILITY.md`](./OBSERVABILITY.md).
- `GET /metrics` — Prometheus scrape endpoint for whatever monitoring stack the deployment environment runs (Phase 6 — see [`OBSERVABILITY.md`](./OBSERVABILITY.md)); point network policy, not app-level auth, at restricting who can reach it.

Point your orchestrator's readiness probe at `/health`; a `503` means don't route traffic yet, not that the process should be killed — Postgres/Redis blips are often transient.

`docker-compose.yml` wires this in directly so the reference topology isn't just documentation:

- **`api`** — Docker `HEALTHCHECK` (also declared in `Dockerfile`) polls `GET /health` every 10s; `docker compose ps` only reports `api` as `healthy` once it returns `200`. `restart: unless-stopped` restarts the container if the process dies or is OOM-killed.
- **`worker`** — has no HTTP surface, so liveness is a heartbeat file (`/var/lib/fanilab/heartbeat/worker.heartbeat`) touched every 15s by the process itself (`src/workers/index.ts`); the healthcheck fails once that file is more than 45s stale, which catches an event-loop-blocked or hung process, not just a crashed one. `restart: unless-stopped` applies the same as `api`.
- The `observability` profile's `prometheus`/`grafana` services `depends_on: api: condition: service_healthy`, so they don't start scraping/rendering against an API that isn't listening yet.

## Evidence Storage

Dispute evidence (`src/modules/disputes/infrastructure/local-evidence-storage.ts`)
is written to `EVIDENCE_STORAGE_DIR`. The `api`/`worker` images create that
directory as `/var/lib/fanilab/evidence`, owned by the non-root `node` user
the containers run as (`Dockerfile`), and `docker-compose.yml` points
`EVIDENCE_STORAGE_DIR` at that same absolute path — the config default
(`./storage/evidence`) is relative to the process working directory and is a
development-only convenience, not something to rely on in a deployed
environment. `createDisputesModule` checks the directory is writable at boot
and fails fast with a clear error if it is not, rather than surfacing as a
generic 500 on the first evidence upload.

## Rollback

Because migrations are a separate, explicit step from image deployment, rolling back the `api`/`worker` images to a previous tag is safe as long as no destructive (column-dropping) migration has been applied since that tag — additive migrations are preferred for exactly this reason during active development.

## Scaling

- `api`: scale horizontally behind a load balancer; no in-memory state to worry about (rate limiting is Redis-backed, sessions are stateless JWTs).
- `worker`: scale horizontally; BullMQ distributes jobs across worker instances automatically. The indexer itself should remain a single logical consumer per contract (its repeatable job is idempotent but not designed for concurrent execution against the same checkpoint — see `EVENT_INDEXER.md`) until the distributed-bus future enhancement in `ARCHITECTURE.md` §11 is implemented.

## Status

`docker compose up` (the full `api`/`worker`/`postgres`/`redis` stack, built from the real `Dockerfile`) was verified for real in Phase 6 — the first time it had actually been run end-to-end. Phase 4's own DoD had flagged this as unverified (no Docker in the sandbox that scaffold was built in), and it stayed unverified through all of Phase 5. Running it for the first time found and fixed three real bugs that had been latent the whole time:

1. **No `.dockerignore`** — `COPY . .` in the Dockerfile's `build` stage pulled in whatever was on the host running `docker build`, most importantly a host-local `node_modules`, clobbering the `deps` stage's own container-built one. Invisible in a clean CI checkout (nothing to pull in); real for any local build on a machine that had already run `pnpm install`.
2. **The `api`/`worker` final stages' Prisma client copy didn't work under pnpm.** The previous approach copied `node_modules/.prisma` from the `build` stage — a path that only exists under npm/yarn's flat `node_modules` layout. Under pnpm's default isolated layout there is no top-level `node_modules/.prisma` at all; the generated client lives nested inside `node_modules/.pnpm/@prisma+client@.../node_modules/.prisma`, and that path's exact suffix depends on which peer/dev dependencies are present in *that stage's own* install — not reliably predictable or portable across a `--prod`-only install. Fixed by installing fully (so `prisma generate`'s postinstall hook has what it needs) and pruning devDependencies afterward, rather than copying a generated artifact cross-stage.
3. **`bcrypt` (and Prisma's own engine download) silently failed to build in a clean install.** Modern pnpm blocks "unsafe" native postinstall build scripts by default unless explicitly approved; a truly fresh install (Docker, CI, a new contributor's first `pnpm install`) hit this, while this repository's own working sandbox had them already approved from before that pnpm default existed — masking the gap entirely until a clean-room build exposed it. Fixed with a `pnpm.onlyBuiltDependencies` allowlist in `package.json`, the durable, version-controlled fix (not just a Docker-specific workaround).
4. **`node:20-slim` has no OpenSSL OS package** — Prisma's query engine binary is dynamically linked against `libssl` and failed at container *runtime* (`Prisma cannot find the required libssl system library`) even though `prisma generate` succeeded at build time. Fixed with `apt-get install openssl` in the base stage, exactly what Prisma's own generate-time warning already recommends for this situation.

All four are now fixed and the full stack (plus the optional `observability` profile, see `OBSERVABILITY.md`) was verified booting, serving traffic, and — for Prometheus/Grafana — actually rendering real scraped data, not just "the containers started."
