# Database

PostgreSQL via Prisma. Full source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma). This document explains *why* the schema looks the way it does — for exact field types, read the schema file itself rather than letting this doc drift out of sync with it.

## Design Principles

1. **This database is a read model / off-chain store, not the source of truth for fund custody or delivery/escrow/dispute state.** Every table that mirrors on-chain state (`deliveries`, `escrows`, `disputes`, `fleets`, `fleet_drivers`, `driver_profiles`) is written exclusively by the blockchain event indexer (see [`EVENT_INDEXER.md`](./EVENT_INDEXER.md)) reacting to confirmed on-chain events — never by a direct API mutation pretending a transaction already succeeded.
2. **Enums mirror on-chain enums exactly** (`delivery_status`, `escrow_status`, `dispute_status`, `cargo_category`, `fleet_driver_status`, `driver_tier`) so the read model can never represent a state the chain doesn't have. See `PHASE_1_DOMAIN_ANALYSIS.md` for the authoritative on-chain enum definitions these are copied from.
3. **`chain_delivery_id` / `chain_fleet_id` are the join keys back to the chain**, not the Prisma-generated `id` — the backend's UUID primary keys are purely a local implementation detail. Any code that needs to correlate with a Soroban contract call uses the chain ID.

## Two On-Chain Layers, Reconciled Into One Table

`PHASE_1_DOMAIN_ANALYSIS.md` §4 and §5 document that the smart contracts currently maintain **two independent dispute-tracking systems** and **two independent reputation counters**. This schema deliberately does not mirror that duplication:

- `disputes` uses `dispute_resolution_contract`'s richer `DisputeStatus` (`OPEN`, `RESOLVED_REFUND`, `RESOLVED_PAYOUT`, `SPLIT`) as the canonical shape, but the indexer also ingests `escrow_contract`'s simpler dispute-adjacent events (`delivery_disputed`, `dispute_resolved`) into the same row's timeline fields, so nothing from either on-chain layer is lost.
- `driver_profiles.reputation_score` / `.deliveries_completed` are sourced from `identity_reputation_contract` (the canonical ledger per the Phase 1 §12 decision). `legacy_deliveries_completed` separately mirrors `delivery_contract`'s own redundant local counter, clearly labeled non-authoritative — it exists for transparency/debugging, never for ranking or eligibility decisions.

### Canonical vs. legacy delivery counters in API responses

The reputation profile endpoint (`GET /reputation/drivers/:address`, see [`API_REFERENCE.md`](./API_REFERENCE.md)) exposes both counters side by side:

- `deliveriesCompleted` is the **canonical** count, read from `driver_profiles.deliveries_completed`, which the indexer populates from `identity_reputation_contract` — the canonical identity-reputation ledger per the Phase 1 §12 decision above. Use this value for product decisions (ranking, eligibility, display).
- `legacyDeliveriesCompleted` is read from `driver_profiles.legacy_deliveries_completed`, which separately mirrors `delivery_contract`'s own redundant local counter. It is non-authoritative and may legitimately differ from the canonical count because the two contracts track completions independently; it exists for transparency/debugging only.

Because the legacy counter is a separate source, a failure to read it does not reset or zero the canonical counter — the two are independent reads, and the canonical value remains the source of truth regardless of the legacy read's outcome.

## Table Ownership and Approved Read Ports

Each table has exactly one owning module, and that module is the only one that writes to it. Cross-module *writes* are never allowed. A small, explicitly approved set of **read-only ports** lets a module read another module's tables through a declared interface rather than reaching into the schema directly. These are the only sanctioned exceptions to "modules never touch each other's tables":

| Port (owner) | Reads | Read-only rationale |
|---|---|---|
| [`UserContactLookup`](../src/modules/notifications/domain/ports.ts) (`notifications`) | `users`, `wallet_addresses` (owned by `auth`) | Resolves a `userId` to contact details when generating notifications; never mutates identity rows. Same precedent `auth` set for `users`. |
| [`AnalyticsRepository`](../src/modules/analytics/domain/ports.ts) (`analytics`) | `escrows`, `driver_profiles` (owned by `deliveries` / `identity`) | Aggregation-only reads (GMV by token, driver tier counts) for reporting; no writes to the source tables. |
| [`AuditLogRepository`](../src/modules/admin/domain/ports.ts) (`admin`) | `audit_logs` (owned by `admin`) | Admin audit reads are append-only and scoped to the admin module's own log; no cross-module mutation. |

These ports are read-only by contract: they expose query methods only, and adding a write path through them is out of scope for this catalog. Ordinary domain/application imports remain subject to the architecture boundary rules in [`ARCHITECTURE.md`](../ARCHITECTURE.md) — this catalog documents existing approved database-read ownership exceptions, it does not authorize new cross-module writes or change any role-update behavior.

## Notifications

`notifications` is not a read model of on-chain state the way `deliveries`/`escrows`/`disputes`/`fleets`/`driver_profiles` are — there is no `notification_*` contract event to sync from. Rows are generated as a side effect of the `notifications` module reacting to *other* modules' blockchain events (see `EVENT_INDEXER.md`), then mutated as delivery is attempted. It resolves `userId` by reading `users`/`wallet_addresses` through the `UserContactLookup` read port listed above. See `src/modules/notifications/domain/ports.ts`'s `UserContactLookup` header comment.

## Fraud Detection

`actor_activities` is also not a read model of on-chain state — it's a durable, append-only log the `fraud-detection` module writes to itself (one row per relevant blockchain event, see `EVENT_INDEXER.md`), never mutated afterward. Deliberately not a pre-computed risk-score table: rule thresholds are evaluated fresh against this log on every `GET /fraud-detection/actors/:address` call rather than maintaining incrementally-updated derived state that could drift — see `src/modules/fraud-detection/domain/ports.ts`'s `ActorActivityRepository` header comment.

**Retention**: rows are kept for `FRAUD_ACTIVITY_RETENTION_DAYS` (default 30 — comfortably above the widest current rule window, 24h, to leave room for future longer-window rules and for forensic/manual review) before a scheduled BullMQ job (`fraud-activity-cleanup` queue, `src/modules/fraud-detection/infrastructure/cleanup-queue.ts`) deletes them, running once a day in the worker process. Deletion is batched (1,000 rows per iteration, `ActorActivityRepository.deleteOlderThan`) so it never holds a long lock over the whole matching range. Because the retention window is always wider than every rule window, this never affects a live assessment — only rows already outside every rule's lookback are ever eligible for deletion.

## Blockchain Indexer Tables

`blockchain_checkpoints` (one row per `(contractName, network)`) and `blockchain_events` (append-only raw event log, unique on `(contractName, network, rpcEventId)` — the Soroban RPC's own globally-unique event id) are the durability layer described in `ARCHITECTURE.md` §6. `blockchain_events` is intentionally kept even after a module has processed an event — it's the replay/audit source if a module's read-model logic needs to be rebuilt.

## Referential Integrity

Foreign keys declare their referential action explicitly rather than relying on Prisma's implicit defaults, so the behavior is identical whether a delete is issued through the Prisma client or raw SQL, and so migrations never drift on the action.

- `FleetDriver.fleet` → `Fleet`: `onDelete: Cascade` — deleting a fleet removes its driver links.
- `Escrow.delivery` → `Delivery` (`chainDeliveryId`): `onDelete: Restrict` — a delivery with an associated escrow cannot be deleted; the escrow must be removed first. This prevents silently orphaning fund-custody state during test cleanup or administrative purges.
- `Dispute.delivery` → `Delivery` (`chainDeliveryId`): `onDelete: Restrict` — same rationale as escrow; a delivery with an associated dispute cannot be deleted.

Attempting to delete a `Delivery` that still has an `Escrow` or `Dispute` row referencing it fails with a foreign key constraint violation (Prisma `P2003`).

## Read-Path Indexes

Several ordered list / aggregation reads filter on one column and sort on
another (or group by one column). Each of those reads is backed by a
composite index matching its exact filter-and-sort (or group-by) shape, so
the planner resolves the predicate and the order from a single index instead
of sorting the matched rows in a second pass:

| Query shape (module) | Composite index |
|---|---|
| `notifications.listByUserId` — `WHERE user_id = ? AND status = ? … ORDER BY created_at DESC` (`notifications`) | `notifications(user_id, created_at desc)` 
