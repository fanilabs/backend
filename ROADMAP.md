# FaniLab Backend — Roadmap

This is the master implementation guide for `fanilab-backend`. It should let another engineer understand exactly how this backend gets built, in what order, and by what standard, without needing to have been in the room for earlier decisions.

Companion documents: [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md) (smart contract source of truth), [`PHASE_2_REFERENCE_ANALYSIS.md`](./PHASE_2_REFERENCE_ANALYSIS.md) (reference-implementation lessons), [`ARCHITECTURE.md`](./ARCHITECTURE.md) (system design).

---

## 1. Vision

FaniLab Backend is the off-chain complement to the FaniLab Soroban smart contracts: it never custodies funds or duplicates escrow/delivery/dispute business logic, but makes the on-chain protocol usable as a real product — identity, KYC, evidence storage, notifications, analytics, fraud detection, and a reliable blockchain event index that gives the frontend (and any future client) a fast, consistent read model instead of querying the chain directly for everything.

It is built to be a credible, maintained open-source project — engineering quality, documentation, and contributor experience are treated as first-class deliverables, not afterthoughts, in service of eventual submission to the Drips Maintainer Program.

## 2. Objectives

1. Provide authenticated, role-based off-chain accounts (customer, courier, fleet manager, admin) mapped to one or more Stellar wallet addresses.
2. Index every event emitted by all six FaniLab contracts into a consistent, queryable PostgreSQL read model, with checkpointed, idempotent, restart-safe ingestion.
3. Expose a documented REST API that builds unsigned Soroban transactions for client-side signing, and tracks their submission/confirmation lifecycle — never holding user private keys.
4. Reconcile the two on-chain dispute-tracking layers and two on-chain reputation-tracking layers (Phase 1 findings) into one coherent backend model, with the discrepancies explicitly documented rather than silently "fixed" on-chain data.
5. Support dispute evidence upload/retrieval, content-hash-verified against the on-chain evidence hash.
6. Deliver notifications, analytics, and a first-pass fraud-detection heuristic layer, all driven off the indexed event stream.
7. Ship with production-grade security, observability, testing, and CI/CD from the first scaffold — not retrofitted later.
8. Maintain clear separation from and complementarity with `FaniLab-SmartContract` — no duplicated business logic, no invented blockchain functionality beyond what the deployed contracts actually support (settlement/currency-swap explicitly excluded until the contract itself is implemented — Phase 1 §8).

## 3. System Architecture Overview

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design. Summary: a modular Clean-Architecture/DDD hybrid Fastify service, PostgreSQL via Prisma, Redis-backed BullMQ for all background work (indexer polling, notifications, reconciliation), a resilient Soroban RPC client layer, and a checkpointed idempotent event indexer feeding module-local read models.

## 4. Module Breakdown

See [`ARCHITECTURE.md` §4](./ARCHITECTURE.md#4-modules-bounded-contexts) for the authoritative table. Modules: `auth`, `users`, `deliveries`, `escrow`, `fleet`, `disputes`, `reputation`, `indexer`, `notifications`, `analytics`, `fraud-detection`, `admin`, plus the `blockchain` and `shared` cross-cutting layers.

## 5. Development Phases

This roadmap follows the task brief's phase gate exactly. Each phase has an explicit **Definition of Done (DoD)** — a phase is not "started" on the next one until its DoD is met.

### Phase 1 — Domain Analysis ✅ Complete
Studied every FaniLab-SmartContract contract, event, storage model, and authorization rule from source (not just docs, which were found to be incomplete/stale). Output: [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md).
**DoD:** Every contract's public functions, events, errors, and cross-contract calls documented; gaps/inconsistencies in the on-chain system explicitly flagged rather than silently worked around. — **Met.**

### Phase 2 — Reference Engineering Review ✅ Complete
Studied `SwiftChain_Backend` for patterns worth adopting/improving. Output: [`PHASE_2_REFERENCE_ANALYSIS.md`](./PHASE_2_REFERENCE_ANALYSIS.md).
**DoD:** Concrete, evidence-based list of practices to adopt and anti-patterns to deliberately avoid, each tied to a specific decision in this project. — **Met.**

### Phase 3 — Architecture & Design ✅ Complete
Architecture diagrams, folder structure, module boundaries, database schema, event flow, API design, dependency graph. Output: [`ARCHITECTURE.md`](./ARCHITECTURE.md), this roadmap.
**DoD:** A new contributor can read `ARCHITECTURE.md` + this roadmap and know where any given feature's code will live, how data flows from chain to API response, and what the DB schema looks like — without having implemented anything yet. — **Met.**

### Phase 4 — Repository Scaffold ✅ Complete
Generated the folder hierarchy, tooling (TypeScript, ESLint flat config with `eslint-plugin-boundaries` enforcing the architecture dependency rule, Prettier, lint-staged/husky), configuration (Zod env schema, fail-fast at boot), a working shared kernel (logger, error hierarchy + Fastify error handler, Prisma client, Redis cache client, BullMQ queue registry, security/docs Fastify plugins, health route), a resilient Soroban RPC client (retry + circuit breaker, unit-tested), Docker + Docker Compose (API, worker, Postgres, Redis), CI/CD (lint/format/typecheck/build/test jobs with Postgres+Redis service containers; Dependabot; release workflow), the full documentation set (`README.md`, `API_REFERENCE.md`, `DATABASE.md`, `AUTHENTICATION.md`, `EVENT_INDEXER.md`, `SECURITY.md`, `DEPLOYMENT.md`, `OBSERVABILITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`), issue/PR templates, `CODEOWNERS`, the full Prisma schema from `ARCHITECTURE.md` §8, empty module directories with the four-layer skeleton (`.gitkeep` only — no fake implementations), and a `Makefile` for common tasks.
**DoD:** `pnpm install && pnpm build` succeeds; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` all pass; the compiled server boots cleanly (verified via a direct `node dist/server.js` smoke test — listens successfully and logs structured, retried connection errors when Postgres/Redis aren't reachable, rather than crashing) — **all verified in this session.** `docker compose up` itself was not verified in this environment (Docker is not installed in the sandbox this scaffold was built in) — verify on first use in an environment with Docker before relying on it. Every module folder exists with its four layers and no other content (no TODOs, no fake implementations).

### Phase 5 — Incremental Module Implementation ✅ Complete
Strict one-module-at-a-time completion, in dependency order (per `ARCHITECTURE.md` §10): `shared`/`blockchain` foundations → `auth` → `users` → `indexer` (minimal: escrow + delivery events only, to unblock the next two) → `deliveries` → `escrow` → `fleet` → `disputes` → `reputation` → `notifications` → `analytics` → `fraud-detection` → `admin` → indexer completed for remaining event types.

**DoD:** every module below shipped with the full DoD in the "Module status" table, CI green throughout, no duplicate/parallel implementations left behind. — **Met.**

Each module, before moving to the next, must ship with:
- Full implementation (domain/application/infrastructure/interface layers)
- Unit tests (domain + application logic) and integration tests (infrastructure — real Postgres/Redis via test containers, not mocks, per the testing strategy below)
- API tests for any exposed endpoints
- Module-level documentation (docstring-level where warranted, plus an entry in the relevant top-level doc — `API_REFERENCE.md`, `DATABASE.md`, `EVENT_INDEXER.md`, etc.)
- Example usage (a request/response example in the OpenAPI schema at minimum; a runnable script under `scripts/examples/` for non-HTTP flows like the indexer)
- Error handling routed through the single shared error hierarchy
- Structured logging at module boundaries
- Input validation via Zod at the interface layer

**DoD per module:** all of the above present, CI green, no other module broken, no duplicate/parallel implementation left behind (the Phase 2 §4 anti-pattern this project is explicitly designed to avoid).

**Module status:**

| Module | Status |
|---|---|
| `shared` / `blockchain` foundations | ✅ Done (Phase 4) |
| `auth` | ✅ Done — register/login/refresh/logout/verify-email/password-reset, RBAC guard, 42 passing unit/infra tests + skip-gated Prisma/API integration tests |
| `users` | ✅ Done — profile read, wallet linking (challenge/signature via real Stellar ed25519 verification), wallet list/unlink, RBAC-ready |
| `indexer` | ✅ Done — full scope, all five contracts with a consuming module (`escrow_contract`, `delivery_contract`, `fleet_management_contract`, `dispute_resolution_contract`, `identity_reputation_contract`; `settlement_contract` permanently excluded — unimplemented stub, `PHASE_1_DOMAIN_ANALYSIS.md` §8), see `EVENT_INDEXER.md` — checkpointed idempotent polling, generic ScVal XDR decoder, BullMQ repeatable job + worker, `GET /health/indexer`, verified against real Postgres and the real public testnet RPC |
| `deliveries` | ✅ Done — read model synced from indexed events (with a supplementary `get_delivery` read call to hydrate the sparse `delivery_created` event), unsigned-XDR builders for all six `delivery_contract` calls, real ScVal struct/enum encoding verified by construction + round-trip (not yet against a live deployment — see `EVENT_INDEXER.md`) |
| `escrow` | ✅ Done — read model synced from indexed events (delivery id read from the event *topic*, not the payload — verified against `escrow_contract`'s distinct convention; `dispute_resolved`'s release/refund ambiguity resolved via a supplementary `get_escrow` read call), unsigned-XDR builders for `create_escrow`/`release_escrow`/`refund_escrow` (dispute-resolution calls deliberately deferred to the future `disputes` module), real ScVal struct/enum encoding verified by construction + round-trip |
| `fleet` | ✅ Done — read model synced from indexed events (every `fleet_management_contract` event carries everything needed directly, unlike escrow/deliveries — no supplementary read call required for sync), unsigned-XDR builders for all five mutating calls (`register_fleet`/`update_fleet_treasury`/`add_driver_to_fleet`/`accept_fleet_invite`/`remove_driver_from_fleet`), plus a live `get_payout_address` read (a derived on-chain view with no corresponding event); `fleet_id` verified as a bare `u64`, no tuple-struct wrapping |
| `disputes` | ✅ Done — read model reconciling **both** on-chain dispute layers (`dispute_resolution_contract`'s five events plus `escrow_contract`'s `delivery_disputed`) into one `Dispute` row per delivery (Phase 1 §5); unsigned-XDR builders for all five `dispute_resolution_contract` mutating calls; evidence upload (local-filesystem storage for v1, sha256 content hash) plus read-time cross-verification of each stored hash against a live `get_dispute` call. `delivery_id` verified as the tuple-wrapped `DeliveryId` struct, unlike `escrow_contract`'s bare `u64`. Documented gaps: `senderShareBps` is never observable from any on-chain event, and a dispute resolved purely through `escrow_contract`'s Layer A (bypassing `dispute_resolution_contract` entirely) stays `OPEN` in this read model — see `EVENT_INDEXER.md` |
| `reputation` | ✅ Done — canonical driver reputation read model sourced from `identity_reputation_contract` (Phase 1 §12 decision: canonical over `delivery_contract`'s own separate, legacy counter); every mutating event (`driver_registered`/`kyc_status_updated`/`reputation_increased`/`reputation_decreased`) triggers a full `get_driver_profile` refresh rather than reimplementing the on-chain `+5+3+2`/cap-at-100 scoring formula locally (ROADMAP §13's no-duplicated-business-logic rule); `tier` recomputed locally as a pure function of score (Bronze/Silver/Gold thresholds verified against `get_driver_tier`); `legacyDeliveriesCompleted` opportunistically refreshed via a second, independent read against `delivery_contract` on the same events, allowed to fail without regressing a previously-known value to 0. Unsigned-XDR builders for `register_driver`/`update_driver_kyc_status` only — `increase_reputation`/`decrease_reputation`/`register_user` deliberately have no builder (see `API_REFERENCE.md`) |
| `notifications` | ✅ Done — dispatches a `Notification` row (channel `EMAIL`) off a deliberately narrow set of blockchain events chosen for carrying a directly-available, worth-notifying actor address (`delivery.driver_assigned`, `escrow.delivery_disputed`, `escrow.escrow_released`, `dispute-resolution.dispute_raised`, all four `identity-reputation` events, five `fleet` events — see `EVENT_INDEXER.md` for exactly which events were excluded and why, which is three different reasons, not one); resolves the address to a local account via a direct (and deliberately documented-as-an-exception) read of `users`/`wallet_addresses`; enqueues a BullMQ delivery job the worker process consumes via the default `NotificationSender` (logs instead of sending real email, same genuinely-functional-dev-default pattern as `auth`'s `Mailer`). Fixed a real, previously-untested gap while wiring this module's own worker: every module's event-subscription wiring only ran in the `api` process, not the `worker` process where the indexer's poll job (the sole publisher) actually runs — see `src/workers/index.ts` and `EVENT_INDEXER.md`'s "Process-boundary correction." `GET /notifications`, `GET /notifications/:id` only — no build endpoints, nothing on-chain to build a transaction for |
| `analytics` | ✅ Done — four read-only aggregate endpoints (`GET /analytics/gmv`, `/completion-rate`, `/dispute-rate`, `/driver-tiers`), `ADMIN`-gated. The one module that reads `deliveries`/`escrows`/`disputes`/`driver_profiles` directly rather than through each owning module's use cases — documented by design (`ARCHITECTURE.md` §4/§10), not an exception. GMV is grouped by token, never summed across tokens; dispute-rate counts every delivery *ever* disputed (the `disputes` table, one row per delivery) rather than a `DISPUTED`-status snapshot, which would undercount once a dispute resolves and the delivery moves on. No time-range filtering in v1 — every figure is all-time |
| `fraud-detection` | ✅ Done — one endpoint (`GET /fraud-detection/actors/:address`, `ADMIN`-gated), evaluating three v1 rule-based velocity heuristics fresh on every call against a durable, append-only `ActorActivity` log this module's own event handler writes to (`DELIVERY_CREATION_VELOCITY`, `ESCROW_RELEASE_VELOCITY`, `DISPUTE_RAISE_VELOCITY` — chosen to match `ARCHITECTURE.md` §4's "delivery/escrow/dispute velocity per actor" as closely as the actually-available event payloads allow). Writes synchronously in its event handler (no BullMQ queue, unlike `notifications`) — a single fast `INSERT` has no failure-prone external channel to isolate from. ML-based scoring and configurable/tunable thresholds are both out of scope for v1, documented future work (`ROADMAP.md` §9) |
| `admin` | ✅ Done — three `ADMIN`-gated endpoints: `GET /admin/disputes` (open-dispute review list, reading `disputes`/`deliveries` directly — the same documented cross-module-read exception `analytics` established, not a new one), `POST /admin/users/:id/role` (off-chain-only role assignment, the third module to touch the shared `users` table directly after `auth`/`users` themselves), and `GET /admin/audit-log` (reads the `audit_logs` table `ARCHITECTURE.md` §4 planned back in Phase 3/4 but nothing had written to until now). Deliberately does **not** build a fourth `POST /admin/disputes/:deliveryId/resolve` path to the same on-chain calls `disputes` already exposes — `admin`'s frontend calls those directly once armed with the review list, avoiding duplicated business logic. No shared "audit-logging decorator" — `admin` is the only consumer so far, so audit-log writing stays module-local rather than speculatively generalized |

### Phase 6 — Hardening & Release Readiness ✅ Complete
Not part of the original task-brief phase gate (§5's Phases 1–5 are) — this formalizes what M8/M9 (§6) already named as the work left after every module shipped: the codebase is feature-complete but has never had a dedicated security pass, has no metrics endpoint despite `OBSERVABILITY.md` planning one since Phase 4, has never been load-tested, and `docker compose up` — the actual deployment runbook — was never verified end-to-end (Phase 4's own DoD flagged this explicitly: no Docker was available in the sandbox that scaffold was built in).

**DoD:**
- ✅ Security review pass completed, real findings fixed (`disputes` evidence IDOR + unrestricted upload — see `SECURITY.md`'s "Security Review History"), `SECURITY.md` reflects actual (not just intended) posture.
- ✅ `GET /metrics` (Prometheus format) and `GET /health/queue` implemented and tested — both were `OBSERVABILITY.md`-planned, not built until now.
- ✅ A local Prometheus + Grafana stack (`docker compose --profile observability up`) scrapes `/metrics` and renders a real starter dashboard against live data — verified visually via Prometheus's own target-health API and Grafana's datasource proxy, not just "the endpoint returns 200."
- ✅ A load test run against the real running server (the actual Docker deployment, not just `pnpm dev`), results documented in `OBSERVABILITY.md`.
- ✅ The full `docker compose up` stack (`api` + `worker` + `postgres` + `redis`, all four, built from the real `Dockerfile`) verified booting and serving traffic — the thing `DEPLOYMENT.md` had described since Phase 4 without ever having been run. Found and fixed four real, previously-latent bugs in the process (missing `.dockerignore`, a Prisma-client-copy step broken under pnpm, native build scripts silently skipped by a pnpm default, missing OpenSSL in the base image) — see `DEPLOYMENT.md`'s "Status" section for detail.
- ✅ `v1.0.0` tagged.

**Status:** Complete.

## 6. Milestones & Deliverables

| Milestone | Deliverable | Depends on | Status |
|---|---|---|---|
| M1 | Phases 1–3 documents merged | — | ✅ Met |
| M2 | Working scaffold, CI green, Docker Compose up | M1 | ✅ Met |
| M3 | Auth + Users live (registration, login, JWT/refresh, wallet linking) | M2 | ✅ Met |
| M4 | Indexer live for escrow + delivery events; Deliveries + Escrow modules live (read + XDR-build endpoints) | M3 | ✅ Met |
| M5 | Fleet + Disputes + evidence upload live | M4 | ✅ Met |
| M6 | Reputation reconciliation + Notifications live | M5 | ✅ Met |
| M7 | Analytics + Fraud-detection v1 + Admin module live | M6 | ✅ Met — Phase 5 complete as of this milestone |
| M8 | Full indexer coverage (all events, all contracts, already true as of M6 — see `EVENT_INDEXER.md`'s "Current Scope"), security review pass, observability dashboards, load test pass | M7 | ✅ Met — Phase 6 |
| M9 | v1.0.0 tagged release, deployment runbook validated on a real environment | M8 | ✅ Met — `v1.0.0` tagged, `docker compose up` validated end-to-end |

## 7. Risks & Assumptions

**Risks:**
- The on-chain system has real inconsistencies (two dispute layers, two reputation ledgers, an unimplemented settlement contract, mixed error-handling conventions — Phase 1). Backend design choices that paper over these silently would misrepresent chain state; every reconciliation decision must be documented, not hidden.
- Soroban RPC availability/rate limits are outside this project's control; the indexer and RPC client must degrade gracefully (retry/backoff/circuit breaker) rather than assume a reliable upstream.
- `fleet_management_contract.get_payout_address` is not automatically honored by `escrow_contract` (Phase 1 §6) — any UX built on the assumption that fleet payouts "just work" on-chain would be incorrect; the backend can only offer a pre-transaction convenience, not an on-chain guarantee.
- Contract addresses/network configuration will change between testnet iterations and eventual mainnet deployment; config must never hardcode contract IDs.

**Assumptions:**
- The smart contracts are the immutable source of truth; this backend does not request or wait on smart-contract changes to proceed — where the chain is missing functionality (e.g. settlement), the backend documents it as future work rather than blocking on it.
- Single-network, single-contract-instance-set deployment is sufficient for v1 (see `ARCHITECTURE.md` §11).
- `FaniLab-Frontend` (or an equivalent client) is responsible for wallet connection and transaction signing; this backend only builds and tracks transactions.

## 8. Dependencies

- `FaniLab-SmartContract` deployed contract IDs and network passphrase (testnet initially) — required before the `indexer`, `escrow`, and `deliveries` modules can be meaningfully tested end-to-end (unit/integration tests can still run against a local Soroban test ledger or mocked RPC responses without a live deployment).
- PostgreSQL 15+, Redis 7+ (Docker Compose provides both for local development).
- No dependency on `FaniLab-Frontend` for backend correctness, but its existing `.env.local` contract-ID variables (seen in the sibling repo's `FANILAB_PROJECT_OVERVIEW.md`) are a useful cross-check that both sides agree on deployed contract IDs.

## 9. Future Enhancements (explicitly out of scope for v1)

- Multi-currency settlement/payout — blocked on the smart-contract `settlement_contract` actually being implemented (currently a stub, Phase 1 §8). `SETTLEMENT_CONTRACT_ID` was removed from `src/shared/config/env.ts` and `.env.example` for the same reason (no consuming module to read it) and returns alongside this work.
- Real-time push (WebSocket/SSE) delivery-tracking layer, mirroring SwiftChain's Socket.IO approach — v1 relies on REST polling + indexed read models; real-time is a natural v1.x addition once the core indexer is proven stable.
- Distributed event bus (Redis Streams or similar) if/when the indexer needs to scale beyond one instance.
- ML-based fraud detection, beyond the v1 rule-based heuristics.
- Multi-region/multi-network contract registry.
- Mobile-specific API affordances, if/when a mobile client is built.

## 10. Testing Strategy

- **Unit tests**: domain and application layers, no I/O, fast, run on every commit.
- **Repository/integration tests**: infrastructure layer against real Postgres/Redis (via Testcontainers or Docker Compose test profile) — explicitly not mocked at this layer, per the Phase 2 §3 lesson that idempotency/checkpoint correctness only means something against a real database.
- **API tests**: Fastify's `inject()` against a fully composed `app.ts` instance, covering validation, auth, and error-mapping behavior.
- **End-to-end tests**: `tests/e2e/` covering full flows (register → link wallet → create delivery → fund escrow → confirm → verify reputation updated) against a local Soroban test ledger where feasible, or a recorded/mocked RPC fixture otherwise.
- **Blockchain event fixtures**: recorded real event payloads from testnet (sanitized) used to drive indexer idempotency and reconciliation tests deterministically.
- CI (GitHub Actions) runs lint, typecheck, unit, integration, and API test jobs on every PR; e2e runs on a schedule and on release branches given its higher cost/flakiness surface.

## 11. Deployment Strategy

- Containerized: separate `api` and `worker` images/targets from one multi-stage `Dockerfile`, plus `postgres` and `redis` in `docker-compose.yml` for local/dev.
- Migrations run via a dedicated `prisma migrate deploy` step in the release pipeline, never automatically on API boot in production.
- Environment promotion: local → staging (testnet contracts) → production (mainnet contracts once the smart-contract side is audited and deployed there — this backend does not gate or accelerate that decision).
- Health/readiness endpoints (`/health`, `/health/indexer`, `/health/queue`) for orchestrator probes.
- Full detail in `docs/DEPLOYMENT.md` (Phase 4 skeleton, filled in as infra is finalized).

## 12. Open-Source Contribution Workflow

- Standard fork-or-branch → PR → CI-green → review → merge flow, documented in `CONTRIBUTING.md` (Phase 4).
- Conventional Commits for changelog/release automation.
- `CODEOWNERS` mapping each module directory to responsible reviewers.
- Issue templates (bug report, feature request) and a PR template requiring a test-plan checklist.
- `CODE_OF_CONDUCT.md` (Contributor Covenant baseline).
- Dependabot for dependency updates, scoped to not auto-merge major version bumps.

## 13. Repository Standards

- TypeScript strict mode, no implicit `any`.
- ESLint + Prettier enforced in CI and via pre-commit hook; architecture boundary lint rule enforcing the dependency rule in `ARCHITECTURE.md` §1.
- Conventional Commits; semantic-release-style versioning for tagged releases.
- No module may import another module's `domain/` or `infrastructure/` directly — only its `application/` public interface (§10 of `ARCHITECTURE.md`).
- No duplicate/parallel implementations of the same entity or concern left in the tree (the single most important lesson from Phase 2) — if something is being replaced, the old version is removed in the same PR.
- Every exported function/class at a module boundary has a one-line doc comment only when it clarifies a non-obvious constraint; no filler documentation.

## 14. Definition of Done — Summary Table

| Phase | DoD |
|---|---|
| 1 | Full contract-by-contract analysis from source, gaps flagged |
| 2 | Evidence-based adopt/avoid list, tied to concrete Phase 3 decisions |
| 3 | Diagrams + schema + folder structure + API design a new contributor can build from |
| 4 | Scaffold builds, tests, lints, and runs in Docker Compose with CI green, zero business logic |
| 5 (per module) | Implementation + unit + integration + API tests + docs + examples + error handling + logging + validation, no duplicate implementations, CI green |
| 6 | Security review pass, metrics endpoint + dashboards, load test, `docker compose up` verified for real, `v1.0.0` tagged |

---

**Current status:** All twelve Phase 5 modules complete — `auth`, `users`, `indexer` (full scope — all five contracts with a consuming module), `deliveries`, `escrow`, `fleet`, `disputes`, `reputation`, `notifications`, `analytics`, `fraud-detection`, and `admin`. Phase 5's final listed step, "indexer completed for remaining event types," is satisfied as a consequence of the above — `indexer`'s tracked-contract scope has covered every contract with a consuming module since `disputes`/`reputation` shipped, not a separate remaining task (see `EVENT_INDEXER.md`'s "Current Scope" section). See §6 (Milestones & Deliverables, M8/M9) for what's still open before a v1.0.0 tag — security review, observability dashboards, a load test pass, and a deployment runbook validated on a real environment, none of which are per-module work.
