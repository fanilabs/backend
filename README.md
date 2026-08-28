# fanilab-backend

Off-chain backend for the FaniLab logistics-escrow platform. It complements the [FaniLab Soroban smart contracts](../FaniLab-SmartContract) — identity, KYC, dispute evidence, notifications, analytics, fraud detection, and a blockchain event index — without ever custodying funds or duplicating the escrow/delivery/dispute business logic that lives on-chain.

[![CI](https://github.com/fanilabs/backend/actions/workflows/ci.yml/badge.svg)](https://github.com/fanilabs/backend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> **Status:** `v1.0.0`. Phase 5 (all twelve modules) and Phase 6 (security review, observability, load test, real `docker compose up` validation) are both complete; see [`ROADMAP.md`](./ROADMAP.md) for the full history and what's next past v1.

## What this is

FaniLab is a blockchain-escrow logistics marketplace built on Stellar Soroban: senders lock payment in an on-chain escrow, drivers deliver, recipients confirm, and the contract releases funds — no bank, no trust required between strangers. This repository is the piece that makes that protocol usable as a real product: accounts and roles, KYC intake, dispute evidence storage, a reliable index of every on-chain event, notifications, and analytics — all read from and written *around* the chain, never in place of it.

Read [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md) first if you want to understand the on-chain system this backend is built against — it documents every contract's functions, events, and a few real inconsistencies in the current contracts that shaped design decisions here (two independent dispute-tracking layers, two independent reputation counters, an unimplemented settlement contract, and more).

## Tech Stack

Node.js · TypeScript · Fastify · PostgreSQL · Prisma · Redis · BullMQ · Zod · Pino · Docker · GitHub Actions · OpenAPI/Swagger

## Architecture

Modular Clean Architecture / DDD hybrid — one bounded-context module per concern (`auth`, `users`, `deliveries`, `escrow`, `fleet`, `disputes`, `reputation`, `indexer`, `notifications`, `analytics`, `fraud-detection`, `admin`), each internally layered `domain → application → infrastructure/interface`. Full design, diagrams, and the database schema: [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Getting Started

### Prerequisites

- Node.js ≥ 20, [pnpm](https://pnpm.io) ≥ 9
- Docker + Docker Compose (for Postgres/Redis, or the full stack)

### Local development

```bash
cp .env.example .env
# fill in JWT secrets at minimum — see .env.example for what's required

pnpm install
make db-up              # Postgres + Redis via Docker
pnpm prisma:migrate
pnpm seed                # optional — populates demo data for every read endpoint
pnpm dev                # API on http://localhost:3000
pnpm dev:worker          # in a second terminal, if you're touching background jobs
```

`pnpm seed` (also `make seed`) creates a development-only `ADMIN` account
(`admin@fanilab.dev` / `DevAdmin123!`) and `CUSTOMER` account
(`customer@fanilab.dev` / `DevCustomer123!`), each with a linked wallet, plus
sample deliveries, escrows, disputes, a fleet with drivers, driver profiles,
notifications, and audit log entries covering every status value so every
`GET` endpoint returns real data without a live Soroban deployment. It's
idempotent (safe to re-run) and refuses to run when `NODE_ENV=production`.
See [`docs/DATABASE.md`](./docs/DATABASE.md) for exactly what it creates.

API docs are served at `http://localhost:3000/api-docs` once the server is running.

### Full stack via Docker Compose

```bash
cp .env.example .env
make docker-up
```

Brings up `api`, `worker`, `postgres`, and `redis`. See the [`Makefile`](./Makefile) for all shortcuts (`make help`).

### Common tasks

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
pnpm test:coverage
pnpm build          # compile to dist/
```

## Documentation

| Doc | Covers |
|---|---|
| [`ROADMAP.md`](./ROADMAP.md) | Vision, phases, milestones, Definition of Done |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Diagrams, folder structure, DB schema, event flow, API design |
| [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md) | Smart contract source-of-truth analysis |
| [`PHASE_2_REFERENCE_ANALYSIS.md`](./PHASE_2_REFERENCE_ANALYSIS.md) | Engineering lessons from a reference implementation |
| [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md) | REST endpoint reference |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Prisma schema reference |
| [`docs/AUTHENTICATION.md`](./docs/AUTHENTICATION.md) | Auth/JWT/RBAC model |
| [`docs/EVENT_INDEXER.md`](./docs/EVENT_INDEXER.md) | Blockchain event indexer design |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Security practices, threat model, disclosure process |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Deployment/runbook |
| [`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md) | Logging, metrics, health checks |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute |

## Related Repositories

- [`FaniLab-SmartContract`](../FaniLab-SmartContract) — the Soroban contracts this backend integrates with (source of truth for all business logic)
- `FaniLab-Frontend` — the client application

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Issues and PRs welcome once the initial module set lands — check `ROADMAP.md` for current phase status before proposing large changes.

## License

[MIT](./LICENSE)
