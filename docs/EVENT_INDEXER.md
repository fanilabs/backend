# Blockchain Event Indexer

The indexer is how every other module learns what happened on-chain. It is the only writer of the `deliveries`, `escrows`, `disputes`, `fleets`, `fleet_drivers`, and `driver_profiles` tables — API routes read them, but only the indexer's event handlers write them, based on confirmed on-chain events, never based on an API request "assuming" a transaction will succeed.

See `ARCHITECTURE.md` §6 for the design summary and sequence diagram this document expands on, and `PHASE_1_DOMAIN_ANALYSIS.md` §9 for the authoritative event catalog across all six contracts.

## Why Polling, Not Push

Soroban RPC exposes `getEvents(startLedger, filters)` — a pull API. There is no push/webhook mechanism from the chain itself, so the indexer runs as a **BullMQ repeatable job** (`QueueName.BlockchainIndexer`, `src/shared/queue/queues.ts`) on an interval (`INDEXER_POLL_INTERVAL_MS`, default 5s), not a long-lived subscription.

## Checkpointing

One `blockchain_checkpoints` row per `(contractName, network)`. Each poll cycle:

1. Read `lastLedgerSeq` for the contract being polled, and the chain's current tip via `SorobanClient.getLatestLedger`.
2. Compute `startLedger`: `lastLedgerSeq + 1`, clamped forward to `latestLedger - INDEXER_EVENT_RETENTION_LEDGERS + 1` if that checkpoint has aged out of the RPC's retention window; or the chain tip itself if there's no checkpoint yet (a freshly deployed/redeployed contract starts from "now," not a backfill).
3. Call `getEvents({ startLedger, filters: [{ contractIds: [contractId] }] })` via `SorobanClient.getEvents` (`src/blockchain/soroban-client.ts` — already wrapped in retry + circuit breaker, so indexer code doesn't need its own retry logic for network-level failures). If the RPC still rejects the range with -32600 (the configured retention estimate was wrong), `createSorobanEventSource` retries once against the exact valid range the RPC's own error reports.
4. Process every returned event (see Idempotent Ingestion, below).
5. Advance `lastLedgerSeq` to the latest ledger actually returned, **only after** every event in that batch has been durably persisted **and** fully handled — a crash mid-batch must not advance the checkpoint past unprocessed events. Handling is backpressured: `publishBlockchainEvent` runs subscribers with bounded concurrency (`EVENT_DISPATCH_CONCURRENCY`, default 10) and only resolves once they've all finished, and the poll loop awaits that promise per event, so batch N+1 is never ingested while batch N's handlers are still running (issue #349).

Restart safety follows directly from this: the indexer always resumes from persisted state, never from "now" — except when persisted state is stale enough that the RPC has already discarded it, in which case it resumes from as far back as the RPC (`INDEXER_EVENT_RETENTION_LEDGERS`) still allows rather than erroring every poll cycle.

## Idempotent Ingestion

Every raw event is written to `blockchain_events` first, with a unique constraint on `(contractName, network, rpcEventId)` (the Soroban RPC's own globally-unique, monotonic event id), **before** any domain handler runs. Re-polling an overlapping ledger range (which can happen — RPC pagination and retries are not guaranteed exactly-once) becomes a harmless upsert-or-skip instead of double-processing a payout or double-incrementing reputation. This is the single most important lesson carried over from `PHASE_2_REFERENCE_ANALYSIS.md` §3 — the reference implementation got this right and it's worth taking seriously.

## Event → Handler Mapping

XDR decoding is isolated behind one generic adapter, `src/blockchain/xdr/sc-val.ts` (`scValToNative`), rather than a bespoke per-event-type parser for all ~30 events across six contracts — stellar-sdk 12.x doesn't ship a built-in `scValToNative`, so this is a scoped equivalent covering the ScVal variants FaniLab's contracts actually use (u32/i32, u64/i64 as strings, u128/i128 as decimal strings, bool, string/Symbol, Address, Vec, Map). Richer, event-specific interpretation (e.g. turning a decoded `escrow_funded` payload into a typed domain event with a known `amount`/`sender`/`recipient` shape) is each consuming module's own job as it's implemented — see **Current Scope** below for why that's deliberately not built yet.

Once decoded, every event is published on the in-process bus (`src/shared/events` — `publishBlockchainEvent`/`onBlockchainEvent`) as a `BlockchainEventEnvelope`. Handlers subscribe to typed events there — not a distributed bus in v1 (see `ARCHITECTURE.md` §11 for why, and when that might change). Dispatch is asynchronous and bounded (`EVENT_DISPATCH_CONCURRENCY`): each publish resolves only after every subscriber for that event has completed — including the log-and-count failure path for handlers that throw — which is what gives the poll loop above its backpressure (issues #348/#349).

| Contract | Events | Primary consumer(s) |
|---|---|---|
| `escrow_contract` | `escrow_funded`, `escrow_released`, `escrow_refunded`, `delivery_disputed`, `dispute_resolved`, `FeeUpdated`, `AdminTransferred`, `ProtocolInitialized` | `escrow`, `disputes`, `notifications` (`escrow_released`/`delivery_disputed` only), `fraud-detection` (`escrow_released`/`delivery_disputed` only) |
| `delivery_contract` | `delivery_created`, `driver_assigned`, `DeliveryInTransit`, `delivery_confirmed`, `delivery_cancelled`, `delivery_disputed` | `deliveries`, `disputes`, `reputation` (legacy counter only), `notifications` (`driver_assigned` only), `fraud-detection` (`delivery_created` only) |
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

## M10 processing foundation (repair branch)

`createPrismaEventStore.tryInsert` now atomically persists each new raw event,
versioned admission metadata and one blocked obligation per required consumer.
Requirements come from `domain/processing-policy.ts`, independently of listener
registration. Existing events without admission metadata remain
`historical_unknown`, including events with a legacy `processedAt` value.
Duplicate receipt preserves that uncertainty and never initiates replay.

`eventProcessingStatus` reports blocked requirements and missing registrations.
Every supported consumer remains blocked by `consumer_recovery_not_verified`;
unknown event policies and the unimplemented users projection are explicitly
unresolved. This foundation offers no successful-completion transition and
executes no consumer effects. Empty requirements do not imply completion.

The checkpointing/idempotent-ingestion claims earlier in this historical document
are not established by the legacy poll/bus implementation: a resolved publish can
include subscriber failures, and an existing raw event is skipped on retry.
The current checkpoint is not a successful-processing frontier. Worker consumer
wiring, durable execution/completion, transaction-scoped effects and ordering,
M34 fraud identity, notification outbox and M11 pagination remain prerequisites.
Retention deletion stays suspended. Do not replay historical events or resend
notifications with ambiguous SMTP outcomes based on this admission foundation.

The additive migration does not repair existing M16/M17 migration-chain failures;
full empty-chain replay and deployment-history reconciliation remain open.

## M10 worker registry and execution gate (repair branch)

The production worker now constructs all seven implemented event consumers via
public worker-only module composition entries (`event-consumer.ts`). These build
real handlers without HTTP routes, storage-directory setup, or subscriptions to
the legacy process-local bus. The registry uses the same IDs as durable admission
obligations, rejects duplicate/missing registrations, and reports the unimplemented
users projection separately. Each registered consumer remains explicitly blocked
by its transaction, ordering, idempotency or outbox prerequisites. Registration
never establishes completion or enables replay.

The indexer worker checks the registry before fetching events or entering the
legacy poll path. Poll jobs currently fail visibly with the blocked prerequisites;
no ingestion or checkpoint progress is made while this gate is closed. This
operational pause prevents worker registration from activating unsafe processing.
Raw admission remains separately available; historical completion stays unknown.
The existing API-local legacy subscriptions are unchanged and are not a durable
processing acknowledgement.

Production startup logs the registration/prerequisite snapshot. It starts the
indexer worker with that same registry and the fail-closed retention worker.
Notification delivery workers are deliberately not started: pending email jobs
must not be consumed before ambiguous-send recovery and notification outbox work
are verified. The former entry referenced this worker without importing it;
starting it during the registry repair would activate previously broken startup
behavior. Pending mail needs explicit operational review before resuming delivery.
Retention deletion stays suspended; M10 completion/recovery, M11 and M34 remain open.

## M10 atomic deliveries status adapter (repair branch)

`createAtomicDeliveryStatusConsumer` accepts an admitted raw-event ID and writes
one `deliveries` consumer completion in the **same PostgreSQL transaction** as
its actual delivery-repository mutation and aggregate ordering position. It
locks the consumer obligation and delivery row; committed duplicates return
without repeating effects. Failures roll back the whole unit. It does not set
the raw event's `processedAt`, complete other consumers, or advance checkpoints.

This adapter supports `driver_assigned`, `DeliveryInTransit`,
`delivery_confirmed`, `delivery_cancelled`, and `delivery_disputed`. The existing
status/timestamp/driver patch semantics are shared with the legacy handler.
`delivery_created` remains blocked: its current-state RPC hydration does not
provide an event-time snapshot. No network call is performed in the transaction.

Ordering is per delivery, not global: proven network-bound ordering provenance
must already exist. Existing rows are not automatically adopted. Stale and
ambiguous same-ledger events fail without acknowledgement; known earlier
unfinished events for the same aggregate block later application. The ordering
probe reads at most 1,001 pending candidates and refuses to infer coverage when
its 1,000-candidate budget is exceeded. It uses the existing ID parser rather
than assuming RPC-ID lexical order or changing supported ID encodings.

This does not establish that all earlier events have been fetched: M11 and
same-ledger ordering remain unresolved. Pinned creation hydration/provenance
initialization and historical reconciliation are prerequisites. Production
registry execution, notification delivery, historical replay and retention
cleanup remain gated. The new completion table is per consumer only; aggregate
processing status remains conservatively blocked. There is no automatic retry
runner or durable failed-attempt journal in this slice. M16/M17 still block full
migration readiness; the new migration is additive and does no historical backfill.
