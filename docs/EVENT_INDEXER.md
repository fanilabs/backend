# Blockchain Event Indexer

The indexer is how every other module learns what happened on-chain. It is the only writer of the `deliveries`, `escrows`, `disputes`, `fleets`, `fleet_drivers`, and `driver_profiles` tables — API routes read them, but only the indexer's event handlers write them, based on confirmed on-chain events, never based on an API request "assuming" a transaction will succeed.

See `ARCHITECTURE.md` §6 for the design summary and sequence diagram this document expands on, and `PHASE_1_DOMAIN_ANALYSIS.md` §9 for the authoritative event catalog across all six contracts.

## Why Polling, Not Push

Soroban RPC exposes `getEvents(startLedger, filters)` — a pull API. There is no push/webhook mechanism from the chain itself, so the indexer runs as a **BullMQ repeatable job** (`QueueName.BlockchainIndexer`, `src/shared/queue/queues.ts`) on an interval (`INDEXER_POLL_INTERVAL_MS`, default 5s), not a long-lived subscription.

## Checkpointing

One `blockchain_checkpoints` row per `(contractName, network)`. Each poll cycle:

1. Read `lastLedgerSeq` for the contract being polled.
2. Call `getEvents({ startLedger: lastLedgerSeq + 1, filters: [{ contractIds: [contractId] }] })` via `SorobanClient.getEvents` (`src/blockchain/soroban-client.ts` — already wrapped in retry + circuit breaker, so indexer code doesn't need its own retry logic).
3. Process every returned event (see Idempotent Ingestion, below).
4. Advance `lastLedgerSeq` to the latest ledger actually returned, **only after** every event in that batch has been durably persisted — a crash mid-batch must not advance the checkpoint past unprocessed events.

Restart safety follows directly from this: the indexer always resumes from persisted state, never from "now."

## Idempotent Ingestion

Every raw event is written to `blockchain_events` first, with a unique constraint on `(contractName, network, rpcEventId)` (the Soroban RPC's own globally-unique, monotonic event id), **before** any domain handler runs. Re-polling an overlapping ledger range (which can happen — RPC pagination and retries are not guaranteed exactly-once) becomes a harmless upsert-or-skip instead of double-processing a payout or double-incrementing reputation. This is the single most important lesson carried over from `PHASE_2_REFERENCE_ANALYSIS.md` §3 — the reference implementation got this right and it's worth taking seriously.

## Event → Handler Mapping

XDR decoding is isolated behind one generic adapter, `src/blockchain/xdr/sc-val.ts` (`scValToNative`), rather than a bespoke per-event-type parser for all ~30 events across six contracts — stellar-sdk 12.x doesn't ship a built-in `scValToNative`, so this is a scoped equivalent covering the ScVal variants FaniLab's contracts actually use (u32/i32, u64/i64 as strings, u128/i128 as decimal strings, bool, string/Symbol, Address, Vec, Map). Richer, event-specific interpretation (e.g. turning a decoded `escrow_funded` payload into a typed domain event with a known `amount`/`sender`/`recipient` shape) is each consuming module's own job as it's implemented — see **Current Scope** below for why that's deliberately not built yet.

Once decoded, every event is published on the in-process bus (`src/shared/events` — `publishBlockchainEvent`/`onBlockchainEvent`) as a `BlockchainEventEnvelope`. Handlers subscribe to typed events there — not a distributed bus in v1 (see `ARCHITECTURE.md` §11 for why, and when that might change).

| Contract | Events | Primary consumer(s) |
|---|---|---|
| `escrow_contract` | `escrow_funded`, `escrow_released`, `escrow_refunded`, `delivery_disputed`, `dispute_resolved`, `FeeUpdated`, `AdminTransferred`, `ProtocolInitialized` | `escrow`, `disputes` |
| `delivery_contract` | `delivery_created`, `driver_assigned`, `DeliveryInTransit`, `delivery_confirmed`, `delivery_cancelled`, `delivery_disputed` | `deliveries`, `disputes`, `reputation` (legacy counter only) |
| `dispute_resolution_contract` | `dispute_raised`, `evidence_added`, `dispute_resolved_refund`, `dispute_resolved_split`, `dispute_resolved_payout` | `disputes`, `reputation` |
| `fleet_management_contract` | `fleet_registered`, `fleet_treasury_updated`, `driver_invited`, `invite_accepted`, `driver_removed` | `fleet` |
| `identity_reputation_contract` | `driver_registered`, `user_registered`, `kyc_status_updated`, `reputation_increased`, `reputation_decreased` | `reputation`, `users` |

Note from `PHASE_1_DOMAIN_ANALYSIS.md` §5: **neither dispute event stream alone tells the full story** — `dispute_resolution_contract`'s events and `escrow_contract`'s dispute-adjacent events must both feed the same `disputes` row per `chainDeliveryId`.

## Lag Monitoring

`now_ledger - lastLedgerSeq` (via `SorobanClient.getLatestLedger()` compared against the checkpoint) is exposed on `GET /health/indexer` and alerted on past `INDEXER_LAG_ALERT_LEDGERS`. This is the "indexer lag as a first-class health signal" pattern adopted from `PHASE_2_REFERENCE_ANALYSIS.md` §3. A contract with no id configured is reported `configured: false` and counts as healthy — "not deployed to this environment yet" isn't a failure.

## Malformed Events

A handler that fails to parse an event logs and records the failure (not silently dropped, not a crash of the whole poll cycle) — the batch continues, and the raw event is still durably stored in `blockchain_events` for later manual inspection or reprocessing.

## Current Scope

Implemented for **`escrow_contract` and `delivery_contract` only** — the minimal slice needed to unblock the `deliveries` and `escrow` modules next (`ROADMAP.md` §5). The polling engine (`createPollContractEventsUseCase`) is fully contract-agnostic; adding `dispute_resolution_contract`, `fleet_management_contract`, `identity_reputation_contract`, and `settlement_contract` later is a matter of adding entries to `getTrackedContracts()` in `src/modules/indexer/index.ts`, not new architecture.

The `deliveries` module is the first real subscriber on the event bus (`src/modules/deliveries/infrastructure/event-subscription.ts`), reacting to `delivery_created`/`driver_assigned`/`DeliveryInTransit`/`delivery_confirmed`/`delivery_cancelled`/`delivery_disputed` and filtering out every other contract's events on the same channel. `escrow_contract`'s events are still ingested (checkpointed and stored) but have no subscriber yet — that's the `escrow` module's job next, not a gap in the indexer itself.

No FaniLab contracts are deployed anywhere reachable from this repository's own environment, so `ESCROW_CONTRACT_ID`/`DELIVERY_CONTRACT_ID` are blank by default (`.env.example`) and the indexer simply skips scheduling for whichever contracts aren't configured, logging a warning rather than failing.

## Status

Implemented (Phase 5). Verified against the real public Soroban testnet RPC (not just fakes) for `getLatestLedger`/`getEvents` connectivity and XDR decoding — there being no deployed FaniLab contracts to fetch real business events from is a deployment-environment fact, not a testing gap; the request/response/decode pipeline itself is proven against a live network. Checkpoint/event-store idempotency is verified against a real Postgres database (CI) or skipped honestly where none is reachable.
