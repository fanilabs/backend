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

## Notifications

`notifications` is not a read model of on-chain state the way `deliveries`/`escrows`/`disputes`/`fleets`/`driver_profiles` are — there is no `notification_*` contract event to sync from. Rows are generated as a side effect of the `notifications` module reacting to *other* modules' blockchain events (see `EVENT_INDEXER.md`), then mutated as delivery is attempted. It resolves `userId` by reading `users`/`wallet_addresses` directly — the one deliberate exception to "modules never touch each other's tables" in this codebase, on the same precedent `auth` already set for `users`. See `src/modules/notifications/domain/ports.ts`'s `UserContactLookup` header comment.

## Fraud Detection

`actor_activities` is also not a read model of on-chain state — it's a durable, append-only log the `fraud-detection` module writes to itself (one row per relevant blockchain event, see `EVENT_INDEXER.md`), never mutated afterward. Deliberately not a pre-computed risk-score table: rule thresholds are evaluated fresh against this log on every `GET /fraud-detection/actors/:address` call rather than maintaining incrementally-updated derived state that could drift — see `src/modules/fraud-detection/domain/ports.ts`'s `ActorActivityRepository` header comment.

**Retention**: rows are kept for `FRAUD_ACTIVITY_RETENTION_DAYS` (default 30 — comfortably above the widest current rule window, 24h, to leave room for future longer-window rules and for forensic/manual review) before a scheduled BullMQ job (`fraud-activity-cleanup` queue, `src/modules/fraud-detection/infrastructure/cleanup-queue.ts`) deletes them, running once a day in the worker process. Deletion is batched (1,000 rows per iteration, `ActorActivityRepository.deleteOlderThan`) so it never holds a long lock over the whole matching range. Because the retention window is always wider than every rule window, this never affects a live assessment — only rows already outside every rule's lookback are ever eligible for deletion.

## Blockchain Indexer Tables

`blockchain_checkpoints` (one row per `(contractName, network)`) and `blockchain_events` (append-only raw event log, unique on `(contractName, network, rpcEventId)` — the Soroban RPC's own globally-unique event id) are the durability layer described in `ARCHITECTURE.md` §6. `blockchain_events` is intentionally kept even after a module has processed an event — it's the replay/audit source if a module's read-model logic needs to be rebuilt.

## Migrations

```bash
pnpm prisma:migrate          # create + apply a dev migration
pnpm prisma:migrate:deploy   # apply pending migrations (CI/production — never `migrate dev` in prod)
pnpm prisma:studio           # browse data locally
```

Migrations are committed to `prisma/migrations/` and reviewed like any other code change — no migration is squashed or edited after merge to `main`.

## Seed Data

`pnpm seed` (`prisma/seed.ts`, also `make seed`, and wired as Prisma's own
`prisma.seed` hook) populates a small, coherent local dataset covering every
read model:

- An `ADMIN` and a `CUSTOMER` user, each with one linked `WalletAddress`.
  Development-only credentials, printed to stdout when the script runs —
  see `README.md` § Local development.
- Six `deliveries`, one per `DeliveryStatus` value.
- Four `escrows`, one per `EscrowStatus` value, linked to a subset of the
  seeded deliveries.
- Four additional deliveries dedicated to disputes, one per `DisputeStatus`
  value, plus one `Evidence` row on the `OPEN` dispute.
- One `Fleet` (owned by the seeded admin) with two `FleetDriver` rows, one
  per `FleetDriverStatus` value.
- Three `DriverProfile` rows, one per `DriverTier` value.
- Three `Notification` rows, one per `NotificationStatus` value.
- Two `AuditLog` rows.

The script upserts on each table's natural unique key (email, wallet
address, `chainDeliveryId`, `chainFleetId`, etc.) or a fixed seed id, so
running it more than once does not create duplicate rows. It refuses to run
when `NODE_ENV=production`.

## Money/Amounts

`escrows.amount` and `.platform_fee` are `Decimal(39, 0)` — exactly large enough to hold any Soroban `i128` value as an integer (`i128::MAX` has 39 digits; `Decimal(38, 0)` is one digit short), never a floating-point representation. Display formatting (applying decimals for a given asset) happens in the application layer, not the database.
