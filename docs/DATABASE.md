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

## Blockchain Indexer Tables

`blockchain_checkpoints` (one row per `(contractName, network)`) and `blockchain_events` (append-only raw event log, unique on `(contractName, network, rpcEventId)` — the Soroban RPC's own globally-unique event id) are the durability layer described in `ARCHITECTURE.md` §6. `blockchain_events` is intentionally kept even after a module has processed an event — it's the replay/audit source if a module's read-model logic needs to be rebuilt.

## Migrations

```bash
pnpm prisma:migrate          # create + apply a dev migration
pnpm prisma:migrate:deploy   # apply pending migrations (CI/production — never `migrate dev` in prod)
pnpm prisma:studio           # browse data locally
```

Migrations are committed to `prisma/migrations/` and reviewed like any other code change — no migration is squashed or edited after merge to `main`.

## Money/Amounts

`escrows.amount` and `.platform_fee` are `Decimal(38, 0)` — large enough to hold a Soroban `i128` value exactly as an integer (the token's smallest unit / stroops-equivalent), never a floating-point representation. Display formatting (applying decimals for a given asset) happens in the application layer, not the database.
