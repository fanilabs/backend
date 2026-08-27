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

### Phase 5 — Incremental Module Implementation
Strict one-module-at-a-time completion, in dependency order (per `ARCHITECTURE.md` §10): `shared`/`blockchain` foundations → `auth` → `users` → `indexer` (minimal: escrow + delivery events only, to unblock the next two) → `deliveries` → `escrow` → `fleet` → `disputes` → `reputation` → `notifications` → `analytics` → `fraud-detection` → `admin` → indexer completed for remaining event types.

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
| `indexer` | Pending |
| `deliveries`, `escrow`, `fleet`, `disputes`, `reputation` | Pending |
| `notifications`, `analytics`, `fraud-detection`, `admin` | Pending |

## 6. Milestones & Deliverables

| Milestone | Deliverable | Depends on |
|---|---|---|
| M1 | Phases 1–3 documents merged | — |
| M2 | Working scaffold, CI green, Docker Compose up | M1 |
| M3 | Auth + Users live (registration, login, JWT/refresh, wallet linking) | M2 |
| M4 | Indexer live for escrow + delivery events; Deliveries + Escrow modules live (read + XDR-build endpoints) | M3 |
| M5 | Fleet + Disputes + evidence upload live | M4 |
| M6 | Reputation reconciliation + Notifications live | M5 |
| M7 | Analytics + Fraud-detection v1 + Admin module live | M6 |
| M8 | Full indexer coverage (all events, all contracts), security review pass, observability dashboards, load test pass | M7 |
| M9 | v1.0.0 tagged release, deployment runbook validated on a real environment | M8 |

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

- Multi-currency settlement/payout — blocked on the smart-contract `settlement_contract` actually being implemented (currently a stub, Phase 1 §8).
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

---

**Current status:** Phase 5 in progress. `auth` and `users` modules complete. Next: `indexer` (minimal — escrow + delivery events).
