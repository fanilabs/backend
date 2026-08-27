# FaniLab Backend — Architecture

**Status:** Phase 3 design output. No business logic is implemented yet — this document is the blueprint Phase 4 (scaffold) and Phase 5 (implementation) build against.

This document assumes familiarity with [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md) (smart contract source of truth) and [`PHASE_2_REFERENCE_ANALYSIS.md`](./PHASE_2_REFERENCE_ANALYSIS.md) (reference-implementation lessons).

---

## 1. Architectural Style

**Modular hybrid of Clean Architecture and Domain-Driven Design**, organized by *bounded context module* rather than by technical layer at the top level. Each module is internally layered:

```
domain/          → entities, value objects, domain errors, repository & port interfaces (no framework/DB/HTTP imports)
application/      → use-cases (application services), orchestration, DTOs, mapping
infrastructure/   → Prisma repository implementations, Soroban clients, external providers
interface/        → Fastify routes, request/response schemas (Zod), controllers (thin)
```

Dependency rule: `interface` → `application` → `domain` ← `infrastructure`. `domain` has zero outward dependencies. `infrastructure` implements `domain` port interfaces (repository pattern) — it depends inward, never the reverse. This is enforced by lint boundary rules (Phase 4) and matches the explicit brief requirement ("clean architecture ... avoid controller-heavy architecture").

Rationale for *module-first* over *layer-first* top-level folders (the opposite of the SwiftChain reference, which mixed everything under one flat `controllers/services/models`): it keeps each bounded context's full vertical slice — and its tests — together, directly preventing the duplicate/parallel-implementation drift observed in Phase 2 (§4).

---

## 2. System Context

```mermaid
flowchart LR
    subgraph Clients
        FE[FaniLab-Frontend<br/>Next.js]
        MOB[Future Mobile Clients]
    end

    subgraph FaniLabBackend[fanilab-backend]
        API[Fastify HTTP API]
        WORKER[BullMQ Workers]
        INDEXER[Soroban Event Indexer]
    end

    PG[(PostgreSQL)]
    REDIS[(Redis)]
    RPC[Soroban RPC<br/>soroban-testnet.stellar.org]

    subgraph Chain[FaniLab-SmartContract]
        ESC[escrow_contract]
        DEL[delivery_contract]
        DIS[dispute_resolution_contract]
        FLT[fleet_management_contract]
        IDR[identity_reputation_contract]
        SET[settlement_contract - stub]
    end

    FE -- REST/OpenAPI --> API
    MOB -. future .-> API
    FE -- signs XDR built by API, submits directly --> RPC

    API --> PG
    API --> REDIS
    API -- enqueue jobs --> REDIS
    WORKER --> REDIS
    WORKER --> PG
    WORKER -- read-only calls --> RPC

    INDEXER -- poll events --> RPC
    INDEXER --> PG
    INDEXER -- enqueue follow-up jobs --> REDIS

    RPC --> ESC
    RPC --> DEL
    RPC --> DIS
    RPC --> FLT
    RPC --> IDR
    RPC -.-> SET
```

Key decision, informed by Phase 2 §5.7: **the backend never holds sender/recipient/driver/fleet-owner private keys.** Every contract call that requires that party's `require_auth()` (which, per Phase 1, is nearly all of them) is exposed as a `POST /transactions/build/...` endpoint that returns an unsigned XDR envelope; the client signs with their own wallet and either submits directly to RPC or posts the signed envelope back to `POST /transactions/submit` for the backend to relay and track. The backend only ever signs transactions for operations that are legitimately backend-owned (e.g., none identified yet at admin level — admin actions in the contracts also require the admin's own signature; if a future backend-managed admin hot-wallet is introduced, that is a distinct, explicitly-scoped security decision documented in `SECURITY.md`, not assumed here).

---

## 3. Layered View

```mermaid
flowchart TB
    subgraph Interface["interface/ (Fastify)"]
        ROUTES[Routes + Zod Schemas]
        PLUGINS[Fastify Plugins:<br/>auth, rate-limit, helmet, swagger]
    end
    subgraph Application["application/"]
        UC[Use Cases / App Services]
        DTO[DTOs + Mappers]
    end
    subgraph Domain["domain/"]
        ENT[Entities + Value Objects]
        PORTS[Repository & Gateway Ports]
        DERR[Domain Errors]
    end
    subgraph Infrastructure["infrastructure/"]
        REPO[Prisma Repositories]
        SOROBAN[Soroban Contract Clients]
        QUEUE[BullMQ Producers]
        CACHE[Redis Cache Adapter]
        MAIL[Notification Providers]
    end

    ROUTES --> UC
    PLUGINS --> ROUTES
    UC --> ENT
    UC --> PORTS
    REPO -. implements .-> PORTS
    SOROBAN -. implements .-> PORTS
    QUEUE -. implements .-> PORTS
    UC --> DTO
```

---

## 4. Modules (Bounded Contexts)

| Module | Owns | Backed by contract(s) | Notes |
|---|---|---|---|
| `auth` | Local accounts, JWT/refresh, email verification, password reset, RBAC | — (off-chain only, Phase 1 §1) | Roles: `CUSTOMER`, `COURIER`, `FLEET_MANAGER`, `ADMIN` |
| `users` | Profile data, wallet-address linking (challenge/signature verification), KYC intake workflow | `identity_reputation_contract` (final KYC boolean only) | KYC documents stored off-chain; only the verified flag is pushed on-chain |
| `deliveries` | Delivery read model, lifecycle orchestration, unsigned-XDR builders for create/assign/transit/confirm/cancel/dispute | `delivery_contract` | State machine mirrored 1:1 from Phase 1 §4; backend never mutates status directly — it reflects indexed events, and only *builds* transactions for the client to sign |
| `escrow` | Escrow read model, XDR builders for create/release/refund, reconciliation worker | `escrow_contract` | Must not assume settlement/currency-swap works (Phase 1 §8) |
| `fleet` | Fleet read model, invite/accept/remove orchestration, **payout-address pre-resolution helper** | `fleet_management_contract` | Resolves `get_payout_address` client-side-callable before `create_escrow` is built, since chain doesn't enforce this automatically (Phase 1 §6) |
| `disputes` | Dispute case read model reconciling both on-chain dispute layers (Phase 1 §5), evidence upload + hash verification | `dispute_resolution_contract`, `escrow_contract` (dispute fields) | Evidence files stored in object storage, content hash must match the 32-byte hash recorded on-chain |
| `reputation` | Canonical driver reputation/tier read model | `identity_reputation_contract` (canonical, per Phase 1 §12 decision), `delivery_contract` (secondary/informational counters, clearly labeled non-authoritative) | |
| `indexer` | Soroban RPC polling, checkpointing, idempotent event ingestion, internal event dispatch | all six contracts | See §6 |
| `notifications` | Multi-channel delivery (email now; SMS/push documented as future work) driven by indexed domain events | — | BullMQ-backed |
| `analytics` | Aggregate reporting (GMV, completion rate, dispute rate, driver tiers distribution) computed from read models | — | Read-only, no writes |
| `fraud-detection` | Heuristic anomaly scoring (v1: rule-based on delivery/escrow/dispute velocity per actor); ML-based scoring explicitly out of scope for v1 and documented as future work | — | Consumes indexed events |
| `admin` | Cross-module admin operations (dispute review UI backend, user management, audit log viewer) | — | RBAC-gated, thin orchestration over other modules |

Cross-cutting **shared kernel** (`src/shared/`): config loading + Zod-validated env schema, logger (Pino), centralized error types + Fastify error handler, audit-logging decorator, Redis client, Prisma client singleton, pagination/response envelope helpers.

---

## 5. Folder Structure

```
fanilab-backend/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── domain/
│   │   │   ├── application/
│   │   │   ├── infrastructure/
│   │   │   └── interface/
│   │   ├── users/            (same internal layout)
│   │   ├── deliveries/
│   │   ├── escrow/
│   │   ├── fleet/
│   │   ├── disputes/
│   │   ├── reputation/
│   │   ├── indexer/
│   │   ├── notifications/
│   │   ├── analytics/
│   │   ├── fraud-detection/
│   │   └── admin/
│   ├── blockchain/
│   │   ├── soroban-client.ts        (resilient RPC wrapper: retry/backoff/circuit-breaker)
│   │   ├── contracts/               (typed client per contract: escrow, delivery, dispute, fleet, identity, settlement)
│   │   └── xdr/                     (sc-val.ts: generic ScVal↔native encode/decode; build-invoke-transaction.ts + simulate-read-call.ts: generic write/read contract-call helpers every module's own contract client builds on)
│   ├── shared/
│   │   ├── config/                  (Zod env schema + typed config)
│   │   ├── errors/                  (single error hierarchy + Fastify error handler)
│   │   ├── logger/
│   │   ├── database/                (Prisma client singleton)
│   │   ├── queue/                   (BullMQ connection + queue registry)
│   │   ├── cache/                   (Redis adapter)
│   │   ├── events/                  (in-process pub/sub — indexer publishes, future modules subscribe)
│   │   ├── http/                    (Fastify plugins: helmet, cors, rate-limit, swagger, auth guard)
│   │   ├── jwt/                     (shared access/refresh token sign+verify)
│   │   └── testing/                 (shared test fixtures/factories + DB/RPC reachability gates)
│   ├── workers/
│   │   └── index.ts                 (BullMQ worker process entrypoint — separate from API process)
│   ├── app.ts                        (Fastify instance composition — no side effects, testable)
│   └── server.ts                     (process bootstrap: app.listen, graceful shutdown)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   ├── API_REFERENCE.md
│   ├── DATABASE.md
│   ├── AUTHENTICATION.md
│   ├── EVENT_INDEXER.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   ├── OBSERVABILITY.md
│   └── adr/                          (Architecture Decision Records, mirroring the smart-contract repo's own ADR practice)
├── tests/
│   └── e2e/                          (cross-module flows; module-local unit/integration tests live inside each module)
├── .github/
│   ├── workflows/                    (ci.yml, release.yml, dependabot config target)
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── docker/
├── docker-compose.yml
├── Dockerfile
├── Makefile
├── .env.example
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CODEOWNERS
└── README.md
```

Module-local tests live next to source (`*.spec.ts` colocated, per Phase 2 §5.6's explicit corrective to SwiftChain's flat `tests/` directory) so coverage gaps are visually obvious in each module.

---

## 6. Blockchain Event Indexer — Design Summary

(Full detail deferred to `docs/EVENT_INDEXER.md` in Phase 4/5; this is the Phase 3 design contract.)

- **Checkpointing**: one `BlockchainCheckpoint` row per contract per network (`contractName`, `network`, `lastLedgerSeq`, `updatedAt`). Polling resumes from the persisted checkpoint, never from "now," so no gap is possible across restarts.
- **Idempotent ingestion**: every raw event is first persisted to `BlockchainEvent` keyed by a unique `(contractName, network, rpcEventId)` constraint (the RPC's own globally-unique event id) *before* domain handlers run, so re-polling an overlapping ledger range is a safe no-op (directly adopting the Phase 2 §3 idempotency lesson).
- **Dual dispute/reputation reconciliation**: handlers for `dispute_resolution_contract`'s five dispute events and `escrow_contract`'s dispute-adjacent events (`delivery_disputed`, `dispute_resolved`) both write into one `Dispute` timeline per `deliveryId`, per the Phase 1 §5 finding that neither contract alone tells the full story.
- **Event-shape adapter boundary**: the raw Soroban RPC → typed-event mapping is isolated behind one adapter interface per contract so a future SDK/event-API migration (Phase 1 §9 — SDK 27 deprecation warning already present in the contracts) only touches `blockchain/contracts/*`, not module domain logic.
- **Dispatch**: after durable ingestion, the indexer publishes an internal domain event (in-process event emitter, not yet a distributed bus — documented as a v2 candidate if the system needs multi-instance indexer scaling) that module-local handlers (deliveries, escrow, disputes, reputation, fleet, notifications, fraud-detection) subscribe to.
- **Lag monitoring**: `now_ledger - lastLedgerSeq` exposed on `/health/indexer` and to the metrics/observability layer, adopting the Phase 2 §3 "indexer lag as first-class health signal" lesson.

```mermaid
sequenceDiagram
    participant RPC as Soroban RPC
    participant IDX as Indexer (BullMQ repeatable job)
    participant DB as PostgreSQL
    participant BUS as In-process Event Bus
    participant MODS as Module Handlers

    IDX->>DB: read BlockchainCheckpoint(contract)
    IDX->>RPC: getEvents(startLedger, contract filter)
    RPC-->>IDX: raw events
    loop each event
        IDX->>DB: upsert BlockchainEvent (idempotent)
        IDX->>BUS: publish typed domain event
        BUS->>MODS: dispatch to subscribed handlers
        MODS->>DB: update read models
        MODS->>REDIS: enqueue follow-up jobs (notify, reconcile)
    end
    IDX->>DB: advance BlockchainCheckpoint
```

---

## 7. Delivery + Escrow Happy-Path Sequence (backend's role)

```mermaid
sequenceDiagram
    actor Sender
    participant API as Fastify API
    participant XDR as XDR Builder
    participant Chain as Soroban Contracts
    participant IDX as Indexer

    Sender->>API: POST /deliveries (metadata)
    API->>XDR: build create_delivery tx
    API-->>Sender: unsigned XDR
    Sender->>Chain: sign + submit create_delivery
    Chain-->>IDX: delivery_created event
    IDX-->>API/DB: Delivery read model (Pending)

    Sender->>API: POST /transactions/build/create-escrow
    API->>XDR: build create_escrow tx
    API-->>Sender: unsigned XDR
    Sender->>Chain: sign + submit create_escrow
    Chain-->>IDX: escrow_funded event
    IDX-->>API/DB: Escrow read model (Locked)

    Note over Sender,Chain: assign_driver / mark_in_transit follow the same build-sign-submit-index pattern

    actor Recipient
    Recipient->>API: POST /transactions/build/confirm-delivery
    API-->>Recipient: unsigned XDR
    Recipient->>Chain: sign + submit confirm_delivery
    Chain->>Chain: cross-call release_escrow
    Chain-->>IDX: delivery_confirmed + escrow_released events
    IDX-->>API/DB: Delivery=Delivered, Escrow=Released, DriverProfile updated
```

---

## 8. Database Schema (Prisma, entity-level — full field list in `docs/DATABASE.md`, Phase 4)

```mermaid
erDiagram
    USER ||--o{ WALLET_ADDRESS : has
    USER ||--o{ REFRESH_TOKEN : has
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ AUDIT_LOG : "acts as actor"
    USER ||--o| FLEET : owns

    DELIVERY ||--o| ESCROW : "funded by"
    DELIVERY ||--o| DISPUTE : "may have"
    DISPUTE ||--o{ EVIDENCE : has
    FLEET ||--o{ FLEET_DRIVER : has
    WALLET_ADDRESS ||--o| DRIVER_PROFILE : "may resolve to"

    USER {
        uuid id PK
        string email UK
        string passwordHash
        enum role
        datetime emailVerifiedAt
        datetime createdAt
    }
    WALLET_ADDRESS {
        uuid id PK
        uuid userId FK
        string address UK
        bool isPrimary
        datetime verifiedAt
    }
    DELIVERY {
        uuid id PK
        bigint chainDeliveryId UK
        string senderAddress
        string recipientAddress
        string driverAddress
        enum status
        jsonb metadata
        datetime createdAt
        datetime deliveredAt
    }
    ESCROW {
        uuid id PK
        bigint chainDeliveryId FK
        string token
        numeric amount
        enum status
        string disputedBy
        datetime disputedAt
    }
    DISPUTE {
        uuid id PK
        bigint chainDeliveryId FK
        enum status
        string raisedBy
        datetime raisedAt
        datetime resolvedAt
    }
    EVIDENCE {
        uuid id PK
        uuid disputeId FK
        string hash
        string storageUrl
        string uploadedBy
    }
    FLEET {
        uuid id PK
        bigint chainFleetId UK
        uuid ownerId FK
        string treasuryAddress
    }
    FLEET_DRIVER {
        uuid id PK
        uuid fleetId FK
        string driverAddress
        enum status
    }
    DRIVER_PROFILE {
        uuid id PK
        string address UK
        int reputationScore
        enum tier
        bool kycVerified
        int deliveriesCompleted
    }
    BLOCKCHAIN_CHECKPOINT {
        uuid id PK
        string contractName
        string network
        bigint lastLedgerSeq
        datetime updatedAt
    }
    BLOCKCHAIN_EVENT {
        uuid id PK
        string contractName
        string txHash
        int eventIndex
        string topic
        jsonb payload
        datetime processedAt
    }
```

`BLOCKCHAIN_EVENT` carries a unique constraint on `(contractName, network, rpcEventId)` — the idempotency key from §6.

---

## 9. API Design Principles

- REST, versioned under `/api/v1`, documented live via `@fastify/swagger` + `@fastify/swagger-ui` (OpenAPI 3.1), Zod schemas as the single source of truth for both validation and generated docs (`fastify-type-provider-zod`).
- Resource-oriented per module (`/deliveries`, `/escrow`, `/disputes`, `/fleets`, `/drivers/:address/reputation`, `/users`, `/auth`), plus a dedicated `/transactions/build/*` family for unsigned-XDR construction and `/transactions/submit` for relaying signed envelopes with status tracking.
- All mutating endpoints that ultimately reflect on-chain state return the **pending, backend-tracked transaction record**, not a synchronously-updated resource — the resource itself only reaches its new state once the indexer confirms the corresponding event, avoiding a false impression of instant consistency the chain doesn't provide.
- Consistent envelope: `{ data, meta }` for success, `{ error: { code, message, details } }` for failures, mapped 1:1 from the single domain error hierarchy (§4/shared kernel).
- Idempotency-Key header support on all `/transactions/build/*` and `/transactions/submit` endpoints, given retries are expected around blockchain submission.

Full endpoint-by-endpoint reference is a Phase 4/5 deliverable (`docs/API_REFERENCE.md`), generated and hand-maintained alongside implementation, not fabricated ahead of the code that defines it.

---

## 10. Module Dependency Graph

```mermaid
flowchart LR
    auth --> users
    users --> deliveries
    users --> fleet
    deliveries --> escrow
    deliveries --> disputes
    escrow --> disputes
    fleet --> escrow
    disputes --> reputation
    indexer --> deliveries
    indexer --> escrow
    indexer --> disputes
    indexer --> fleet
    indexer --> reputation
    indexer --> notifications
    indexer --> fraud-detection
    deliveries --> notifications
    disputes --> notifications
    analytics -.reads read-models only.-> deliveries
    analytics -.-> escrow
    analytics -.-> disputes
    analytics -.-> reputation
    admin -.orchestrates.-> disputes
    admin -.orchestrates.-> users
    admin -.orchestrates.-> analytics
```

No module reaches into another module's `infrastructure/` or `domain/` internals directly — cross-module reads go through the other module's public `application/` use-case interface, keeping the boundary enforceable by lint rule in Phase 4.

---

## 11. Deferred/Open Design Questions (carried from Phase 1 §12, not resolved here)

- Whether reputation reconciliation should attempt to *also* surface `delivery_contract`'s redundant counters (informational-only field) or omit them entirely from the API — leaning toward surfacing as a clearly-labeled secondary field for transparency/debugging, final call in Phase 5 when the `reputation` module is implemented.
- Whether an internal event bus is sufficient long-term or whether a distributed bus (e.g. Redis Streams) is needed once the indexer needs to run as more than one instance — out of scope for v1, documented in `ROADMAP.md` future enhancements.
- Multi-network/multi-deployment contract-registry support — v1 assumes a single active network/contract-ID set from config; a `ContractRegistry` table is a documented future enhancement if multi-region deployment becomes a requirement.
