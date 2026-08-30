# End-to-end tests (`tests/e2e/`)

These are the end-to-end tests referenced by `ROADMAP.md` §10. Per that
section they deliberately **do not** run on every PR — they run **on a
schedule and on release branches** (a nightly scheduled run plus `release/**`
branch / `v*.*.*` tag pushes; see `.github/workflows/e2e.yml`), because they
boot the fully-composed server and hit it end-to-end, which is costlier and
flakier than the src-scoped unit/integration/API suite.

## Why a separate config/script

- Fast per-PR jobs (`pnpm test` / `test:coverage`) include **src only** —
  `vitest.config.ts` — so they never sweep these in.
- E2E runs via its own project: `vitest.e2e.config.ts`, wired to
  `pnpm test:e2e` (watch mode: `pnpm test:e2e:watch`).

## Running them

The suite needs the real Postgres + Redis stack (same skip-not-fail gating as
the `*.integration.spec.ts` suites — it skips, never fails, if the stack is
down). Typical local setup, matching CI:

```bash
make db-up          # or otherwise bring up Postgres + Redis on localhost
pnpm install
pnpm prisma:migrate:deploy
pnpm test:e2e
```

## Current coverage (smoke-level)

`app.e2e.spec.ts` boots the exact `buildApp()` composition behind
`src/server.ts` as a real HTTP server and verifies against live Postgres +
Redis: `/health` reports `ok`, a composed module route is mounted under
`/api/v1`, and `/health/queue` reports over HTTP. This pins the harness's
wiring so the scheduled/release job already exercises a real end-to-end path.

## Intended full-flow tests (next step)

`ROADMAP.md` §10 names the target flows:

> register → link wallet → create delivery → fund escrow → confirm → verify
> reputation updated

These need a local Soroban test ledger (or a recorded/mocked RPC fixture), since
no FaniLab contracts are deployed anywhere this repository controls (the same
constraint documented in
`src/modules/indexer/infrastructure/soroban-event-source.integration.spec.ts`).
When a ledger/fixture is available, add specs here following the existing
pattern: the real `buildApp()` server + live Postgres/Redis, driving the full
flow over HTTP with real Stellar signatures (see the wallet-link flow in
`src/modules/users/interface/users-routes.integration.spec.ts`).