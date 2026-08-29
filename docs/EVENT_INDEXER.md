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

Implemented for **`escrow_contract`, `delivery_contract`, `fleet_management_contract`, `dispute_resolution_contract`, and `identity_reputation_contract`** — every contract with a consuming module (`ROADMAP.md` §5). `settlement_contract` is the sole permanent exception: it's an unimplemented stub with no consuming module planned (`PHASE_1_DOMAIN_ANALYSIS.md` §8), not a gap waiting to be filled. The polling engine (`createPollContractEventsUseCase`) is fully contract-agnostic; adding a contract is a matter of adding an entry to `getTrackedContracts()` in `src/modules/indexer/index.ts`, not new architecture.

The `deliveries` module was the first real subscriber on the event bus (`src/modules/deliveries/infrastructure/event-subscription.ts`), reacting to `delivery_created`/`driver_assigned`/`DeliveryInTransit`/`delivery_confirmed`/`delivery_cancelled`/`delivery_disputed` and filtering out every other contract's events on the same channel.

`escrow` is the second subscriber (`src/modules/escrow/infrastructure/event-subscription.ts`/`sync-escrow-from-event.ts`), reacting to `escrow_funded`, `escrow_released`, `escrow_refunded`, `delivery_disputed`, and `dispute_resolved`. Two things worth calling out because they're easy to get wrong and were verified directly against `escrow_contract/lib.rs`, not assumed from `delivery_contract`'s convention:

- **The delivery id lives in the event's *topic* (`topic[1]`), not its payload.** `delivery_contract` puts `delivery_id` inside the payload (topic is a single-segment `(Symbol,)`); `escrow_contract` puts it in the topic itself (`(Symbol, delivery_id)`, 2 segments). A handler that read `payload[0]` here would silently look up the wrong (or no) escrow.
- **`dispute_resolved` is ambiguous by itself** — `resolve_dispute`'s two branches (release vs. refund) both emit the identical `dispute_resolved` event, so the handler can't tell the outcome from the event alone. It resolves this with a supplementary `get_escrow` read call and writes whichever status (`RELEASED` or `REFUNDED`) the contract actually reports, rather than guessing.
- **`escrow_funded`'s payload doesn't carry `driver`/`token`** either, so that handler also hydrates the full record via `get_escrow` rather than trying to piece it together from the event alone.
- **`platformFee` is only known from `escrow_released`'s payload** (`(driver, payout, fee)`) — a release reached via `dispute_resolved` doesn't carry it, so `platformFee` stays `null` for that path. This is a real read-model gap, documented rather than papered over with a guess.

`fleet` is the third subscriber (`src/modules/fleet/infrastructure/event-subscription.ts`/`sync-fleet-from-event.ts`), reacting to `fleet_registered`, `fleet_treasury_updated`, `driver_invited`, `invite_accepted`, and `driver_removed`. Unlike `escrow_contract`, `fleet_management_contract` puts `fleet_id` in the payload's first element (single-segment topic), same convention as `delivery_contract` — verified directly against `fleet_management_contract/lib.rs`. No event here has a sparse payload needing a supplementary read call.

`disputes` is the fourth subscriber (`src/modules/disputes/infrastructure/event-subscription.ts`/`sync-dispute-from-event.ts`), and the first one to subscribe to **two** contracts' events for one read model, per `PHASE_1_DOMAIN_ANALYSIS.md` §5's "two dispute layers" finding:

- From `dispute_resolution_contract` (contractName `dispute-resolution`): `dispute_raised`, `dispute_resolved_refund`, `dispute_resolved_split`, `dispute_resolved_payout`. `evidence_added` is deliberately a no-op in the sync path — evidence rows are written by the `uploadEvidence` use case at upload time and cross-checked against the chain's `evidence_hashes` at read time instead (see `API_REFERENCE.md`'s disputes section).
- From `escrow_contract` (contractName `escrow`): `delivery_disputed` and `dispute_resolved`. `escrow_contract.dispute_resolved` is ambiguous by itself — both of `resolve_dispute`'s branches (and `resolve_dispute_split`) emit that identical event — so, mirroring `escrow`'s own `get_escrow` fallback, this handler reads a narrow `DisputeEscrowStateReader.getEscrowStatus` (its own supplementary `get_escrow` read, decoding only `status`) and maps `RELEASED`/`REFUNDED` to `RESOLVED_PAYOUT`/`RESOLVED_REFUND`. This is only ever applied while the dispute is still `OPEN`: the dispute-resolution-contract events above remain authoritative, and a resolution they've already recorded is never overwritten by a later Layer A event.
- **`delivery_id` is the tuple-wrapped `DeliveryId` struct for every `dispute_resolution_contract` event**, not the bare `u64` `escrow_contract` uses — verified directly against `dispute_resolution_contract/lib.rs`. Since `BlockchainEventEnvelope.topic` is always `string[]` (see below), this arrives as the JSON string `'["1"]'`, not a native array.
- A dispute raised *and* resolved purely through `escrow_contract`'s Layer A, without ever touching `dispute_resolution_contract`, now reaches a resolved status via the `get_escrow` fallback above rather than staying `OPEN` indefinitely.

Topic segments are always decoded then re-stringified to plain `string[]` (`soroban-event-source.ts`'s `stringifyTopicSegment`, `JSON.stringify`-ing anything that isn't already a string) before an event reaches any handler — this is why a tuple-wrapped id in the topic (as above) round-trips as a JSON string rather than a native array, while the same value in the event *payload* (`unknown`, never stringified) stays a native array/object.

`reputation` is the fifth and final subscriber (`src/modules/reputation/infrastructure/event-subscription.ts`/`sync-reputation-from-event.ts`), reacting to `identity_reputation_contract`'s `driver_registered`, `kyc_status_updated`, `reputation_increased`, and `reputation_decreased` (contractName `identity-reputation`). Unlike every other module, none of these payloads are patched into the read model incrementally — `reputation_increased`/`_decreased` carry only a caller/points delta, never the resulting score, and this backend must not reimplement the on-chain `+5+3+2`/cap-at-100 scoring formula itself (`ROADMAP.md` §13's "no duplicated business logic" rule — a local copy would silently drift if the contract's formula ever changed). Every one of these four events instead triggers the same full refresh: a supplementary `get_driver_profile` read call, same rationale as `escrow`'s `escrow_funded`/`dispute_resolved` handlers. `tier` (`BRONZE`/`SILVER`/`GOLD`) has no on-chain event of its own either — it's a pure function of `reputationScore` (thresholds verified directly against `identity_reputation_contract::get_driver_tier`), so it's recomputed locally rather than fetched via yet another RPC call. `user_registered` is intentionally a no-op — this module's schema (frozen in Phase 4) has no read model for the on-chain `UserProfile` it creates, only for driver reputation.

This handler also opportunistically reads a **second, unrelated contract** on every refresh: `delivery_contract.get_driver_profile` (via `DELIVERY_CONTRACT_ID`, not `IDENTITY_REPUTATION_CONTRACT_ID`), to populate `legacyDeliveriesCompleted` — `delivery_contract`'s own, entirely separate driver counter (`PHASE_1_DOMAIN_ANALYSIS.md` §4/§12). This secondary read is allowed to fail independently (no `delivery_contract` deployment configured, RPC error, driver has no legacy profile yet) without failing the primary refresh — `legacyDeliveriesCompleted` is simply left at its prior value (or Prisma's own column default on first insert) rather than being regressed to `0` on a transient failure.

No FaniLab contracts are deployed anywhere reachable from this repository's own environment, so every `*_CONTRACT_ID` variable is blank by default (`.env.example`) and the indexer simply skips scheduling for whichever contracts aren't configured, logging a warning rather than failing.

`notifications` is the sixth subscriber (`src/modules/notifications/infrastructure/event-subscription.ts`/`dispatch-notifications-from-event.ts`), and the first one that isn't syncing a read model — it turns a handful of events into `Notification` rows instead. Two resolution paths, as of #101:

- **Direct address events** — the actor address is directly usable from the event's own topic/payload: `delivery.driver_assigned`, `escrow.delivery_disputed`, `escrow.escrow_released` (payload `(driver, payout, fee)`, verified against this doc's own escrow section below), `dispute-resolution.dispute_raised`, all four `identity-reputation` events, and five of `fleet`'s events.
- **Counterparty-resolved events** — `delivery.delivery_confirmed`, `delivery.delivery_cancelled`, `delivery.DeliveryInTransit`, `escrow.escrow_refunded`, and the three `dispute-resolution.dispute_resolved_*` events carry only a `delivery_id` (plus, for the dispute-resolution events, the resolving admin's own address). These now resolve the delivery's `sender`/`driver` via a `DeliveryPartyLookup` port that reads `deliveries`' own table directly — the same documented, `ARCHITECTURE.md`-sanctioned cross-module read exception `UserContactLookup` already establishes for this module. `dispute_resolved_*`'s resolving admin address is excluded from the result, so the admin is never notified of their own action; `recipient` is resolved but never used as a target (see `domain/ports.ts`'s `DeliveryPartyLookup` header comment).

Still excluded: `delivery_created` (payload's sender, `payload[1]`, is the actor's own just-submitted action — no useful *other* party exists yet at that point, since a driver isn't assigned); the escrow-layer `dispute_resolved` (ambiguous release-vs-refund by itself, same reasoning `disputes`' own sync handler documents); and `escrow_funded`, whose payload contents beyond "no driver/token" aren't documented anywhere verifiable. An address with no linked local account is silently skipped, not an error, and duplicate addresses resolved for the same event (e.g. sender and driver being the same account) are only notified once. See `dispatch-notifications-from-event.ts`'s header comment for the full per-event breakdown.

`fraud-detection` is the seventh and final Phase-5 subscriber (`src/modules/fraud-detection/infrastructure/event-subscription.ts`/`record-actor-activity-from-event.ts`) — also not syncing a read model, and unlike `notifications` also not queue-backed: a single durable `INSERT` into its own `ActorActivity` log has no failure-prone external channel to isolate the handler from, so it writes synchronously, the same direct-write pattern `deliveries`/`escrow`/`disputes`/`reputation`/`fleet` already use. Three event/address pairs, chosen to match `ARCHITECTURE.md` §4's "delivery/escrow/dispute velocity per actor" as closely as the actually-available payloads allow: `delivery.delivery_created` (sender, `payload[1]`), `escrow.escrow_released` (driver, `payload[0]`), and `escrow.delivery_disputed` (disputing party, `payload[0]`). No rule evaluation happens in the handler — `assess-actor.ts` evaluates fixed-threshold rules against the logged counts at read time, on every call, rather than maintaining an incrementally-updated score that could drift.

**Process-boundary correction (Phase 5)**: "in-process event emitter" in this doc and `ARCHITECTURE.md` §6 is literal — publishing and subscribing must happen in the *same OS process*. The indexer's poll job (the only publisher) runs in the `worker` container (`src/workers/index.ts`), not the `api` container `app.ts` builds — so every module's event-subscription wiring must also be triggered from `workers/index.ts`, not only from `app.ts` (which every module's `createXModule` factory also does, harmlessly, for the routes that *do* need to live there). This was a real gap — discovered while wiring `notifications`, fixed by having `workers/index.ts` construct every event-consuming module too — see that file's header comment.

## Status

Implemented (Phase 5). Verified against the real public Soroban testnet RPC (not just fakes) for `getLatestLedger`/`getEvents` connectivity and XDR decoding — there being no deployed FaniLab contracts to fetch real business events from is a deployment-environment fact, not a testing gap; the request/response/decode pipeline itself is proven against a live network. Checkpoint/event-store idempotency is verified against a real Postgres database (CI) or skipped honestly where none is reachable. The full publish→dispatch→queue→send pipeline (including the process-boundary fix above) was verified end-to-end with a real Postgres + Redis and a real BullMQ worker, not just at the unit level.
