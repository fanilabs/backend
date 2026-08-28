# API Reference

The live, authoritative reference is generated from the same Zod schemas that validate requests (`fastify-type-provider-zod`) and served at **`/api-docs`** (OpenAPI 3.1 / Swagger UI) whenever the server is running. This document is a human-readable index alongside it — if the two ever disagree, `/api-docs` is correct and this file needs updating.

## Conventions

- All routes are versioned under `/api/v1` except `/health*` and `/api-docs`.
- Success responses: `{ "data": ..., "meta"?: {...} }`.
- Error responses: `{ "error": { "code": "...", "message": "...", "details"?: ... } }` — see `src/shared/errors` for the full code list.
- Mutating endpoints that reflect on-chain state (deliveries, escrow, disputes, fleet) return a **pending transaction record**, not a synchronously-updated resource — the underlying resource only reaches its new state once the blockchain indexer confirms the corresponding on-chain event. See `ARCHITECTURE.md` §9.
- Endpoints that require a wallet-owned signature (`sender`, `recipient`, `driver`, `fleet owner` actions per `PHASE_1_DOMAIN_ANALYSIS.md`) live under `/transactions/build/*` and return unsigned XDR — this backend never signs on a user's behalf (`AUTHENTICATION.md`).

## Implemented Today

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness/readiness: database + Redis connectivity |
| `GET` | `/health/indexer` | Per-contract blockchain indexer lag (`now_ledger - lastLedgerSeq`); `200` when all tracked contracts are within `INDEXER_LAG_ALERT_LEDGERS`, `503` otherwise. See `EVENT_INDEXER.md`. |
| `GET` | `/health/queue` | Per-queue BullMQ job counts; `503` if any monitored queue has a job that exhausted its retries. See `OBSERVABILITY.md`. |
| `GET` | `/metrics` | Prometheus-format scrape endpoint (HTTP latency/count, indexer lag, queue depth). See `OBSERVABILITY.md`. |
| `GET` | `/api-docs` | Interactive OpenAPI/Swagger UI |
| `POST` | `/api/v1/auth/register` | Create a local account (`email`, `password`) — sends a verification email (logged locally in dev, see `AUTHENTICATION.md`) |
| `POST` | `/api/v1/auth/login` | Exchange credentials for an access + refresh token pair |
| `POST` | `/api/v1/auth/refresh` | Rotate a refresh token for a new access + refresh pair; the presented token is revoked |
| `POST` | `/api/v1/auth/logout` | Revoke a refresh token (idempotent — unknown/already-revoked tokens still return success) |
| `POST` | `/api/v1/auth/verify-email` | Consume an email verification token (idempotent) |
| `POST` | `/api/v1/auth/request-password-reset` | Always returns success — no user enumeration; sends a reset email only if the address is registered |
| `POST` | `/api/v1/auth/reset-password` | Consume a password reset token, set a new password, revoke all existing sessions |

All `auth` error responses use the shared envelope: `409 CONFLICT` (duplicate email), `401 UNAUTHORIZED` (bad credentials / invalid or expired token), `400 VALIDATION_ERROR` (malformed request body). See `AUTHENTICATION.md` for the full design (token formats, rotation, password-reset fingerprinting).

| `GET` | `/api/v1/users/me` | The authenticated user's profile plus linked wallet addresses (requires `Authorization: Bearer <access token>`) |
| `GET` | `/api/v1/users/me/wallets` | List the authenticated user's linked wallet addresses |
| `POST` | `/api/v1/users/me/wallets/challenge` | Issue a short-TTL (5m) challenge string for a Stellar address the client wants to link — `{ address }` → `{ challenge }` |
| `POST` | `/api/v1/users/me/wallets/confirm` | Complete linking: `{ address, challenge, signature }`, where `signature` is the ed25519 signature (base64) of `challenge` produced by the wallet's own key. The first wallet a user links becomes their primary. |
| `DELETE` | `/api/v1/users/me/wallets/:id` | Unlink a wallet (must belong to the requesting user — `403 FORBIDDEN` otherwise) |

All `/api/v1/users/*` routes require authentication; unauthenticated requests get `401 UNAUTHORIZED`. See `AUTHENTICATION.md` § Wallet Linking for the full challenge/signature design and why it never touches a private key.

| `GET` | `/api/v1/deliveries` | List deliveries — public read model, optional `senderAddress`/`recipientAddress`/`driverAddress`/`status` query filters |
| `GET` | `/api/v1/deliveries/:chainDeliveryId` | Get one delivery by its on-chain id (`404` if not yet indexed) |
| `POST` | `/api/v1/transactions/build/create-delivery` | Unsigned XDR for `delivery_contract.create_delivery` — `{ senderAddress, recipientAddress, origin, destination, cargoCategory, weightGrams, fragile, estimatedDelivery }` |
| `POST` | `/api/v1/transactions/build/assign-driver` | Unsigned XDR for `assign_driver` — caller is admin or the driver self-assigning |
| `POST` | `/api/v1/transactions/build/mark-in-transit` | Unsigned XDR for `mark_in_transit` — the assigned driver only |
| `POST` | `/api/v1/transactions/build/confirm-delivery` | Unsigned XDR for `confirm_delivery` — the recipient only |
| `POST` | `/api/v1/transactions/build/cancel-delivery` | Unsigned XDR for `cancel_delivery` — the sender only |

All `/api/v1/transactions/build/*` routes require authentication (anti-abuse — each call does real RPC work: an account fetch and a full simulate/prepare). All return `{ "data": { "xdr": "<unsigned envelope>" } }`. `GET /deliveries*` is public — it mirrors public on-chain state, like a block explorer. If `DELIVERY_CONTRACT_ID` isn't configured for the running environment (blank by default, see `.env.example`), the build endpoints return `502 BLOCKCHAIN_ERROR` with a clear message rather than a generic failure.

**Encoding caveat**: `create-delivery`'s request body is encoded into `delivery_contract`'s `DeliveryMetadata`/`CargoDescriptor` Soroban struct types following the documented `#[contracttype]` conventions (see `src/modules/deliveries/infrastructure/delivery-scval-mapping.ts`), verified by construction and by round-tripping through this repo's own decoder — but not yet against a live deployed `delivery_contract`, since none is deployed anywhere reachable from this repository's environment. Treat this as the first thing to verify once a real testnet deployment exists.

| `GET` | `/api/v1/escrow/:chainDeliveryId` | Get one escrow by its on-chain delivery id (`404` if not yet indexed) |
| `POST` | `/api/v1/transactions/build/create-escrow` | Unsigned XDR for `escrow_contract.create_escrow` — `{ senderAddress, recipientAddress, driverAddress, chainDeliveryId, token, amount }`; caller/source is the sender |
| `POST` | `/api/v1/transactions/build/release-escrow` | Unsigned XDR for `release_escrow` — `{ callerAddress, chainDeliveryId }`; caller must be the recipient or admin (enforced on-chain, not re-checked here) |
| `POST` | `/api/v1/transactions/build/refund-escrow` | Unsigned XDR for `refund_escrow` — `{ callerAddress, chainDeliveryId }`; caller must be the sender or admin |

Same auth/config-fallback rules as deliveries: all three build endpoints require authentication, and return `502 BLOCKCHAIN_ERROR` if `ESCROW_CONTRACT_ID` isn't configured. `raise_dispute`/`resolve_dispute` are deliberately **not** exposed here — they belong to the future `disputes` module (`ARCHITECTURE.md` §4), which owns the full two-layer dispute/arbitration flow.

**Encoding caveat**: same as deliveries above — `escrow-scval-mapping.ts` encodes/decodes `escrow_contract`'s `EscrowRecord`/`EscrowState` types by construction and round-trip only, not yet against a live deployment. One escrow-specific note: `delivery_id` is a **bare `u64`** argument for every `escrow_contract` call, unlike `delivery_contract`'s tuple-wrapped `DeliveryId` — verified directly against `escrow_contract/lib.rs`.

**Read-model gaps** (see `EVENT_INDEXER.md` for the full event-to-state mapping): `platformFee` is `null` until an escrow reaches `RELEASED` (it's only known from the `escrow_released` event payload — a `dispute_resolved`-driven release doesn't carry it, so it stays `null` in that path); `dispute_resolved` events are ambiguous about outcome (both the release and refund branches emit the identical event), so the indexer resolves the actual status via a supplementary `get_escrow` read call rather than guessing from the event alone.

| `GET` | `/api/v1/fleets/:chainFleetId` | Get one fleet (with its drivers) by its on-chain id (`404` if not yet indexed) |
| `GET` | `/api/v1/fleets/:chainFleetId/payout-address/:driverAddress` | Live `get_payout_address` read — resolves to the fleet treasury if the driver is `ACTIVE` in that fleet, else the driver's own address. A pre-transaction convenience only; `escrow_contract` never calls this itself (`PHASE_1_DOMAIN_ANALYSIS.md` §6) |
| `POST` | `/api/v1/transactions/build/register-fleet` | Unsigned XDR for `register_fleet` — `{ ownerAddress, treasuryAddress }` |
| `POST` | `/api/v1/transactions/build/update-fleet-treasury` | Unsigned XDR for `update_fleet_treasury` — owner only |
| `POST` | `/api/v1/transactions/build/add-driver-to-fleet` | Unsigned XDR for `add_driver_to_fleet` — owner only |
| `POST` | `/api/v1/transactions/build/accept-fleet-invite` | Unsigned XDR for `accept_fleet_invite` — the invited driver |
| `POST` | `/api/v1/transactions/build/remove-driver-from-fleet` | Unsigned XDR for `remove_driver_from_fleet` — owner or the driver themself |

| `GET` | `/api/v1/disputes/:chainDeliveryId` | Get one dispute (with its evidence list) by its on-chain delivery id (`404` if not yet indexed). Each evidence item's `confirmedOnChain` flag is computed at read time against a live `get_dispute` call — see the Read-model gaps note below |
| `POST` | `/api/v1/disputes/:chainDeliveryId/evidence` | Upload an evidence file — `{ uploadedBy, contentType, base64Content }`. Stores the file, computes and returns its sha256 hex hash; the client must then submit that exact hash via `add-evidence-hash` for it to be recorded on-chain. Only while the dispute is `OPEN` (`409 CONFLICT` otherwise, mirroring `add_evidence_hash`'s on-chain guard). `uploadedBy` must be a wallet the caller actually owns (linked via `users`' challenge/signature flow) — `403 FORBIDDEN` otherwise |
| `GET` | `/api/v1/disputes/evidence/:evidenceId/download` | Streams back a previously uploaded evidence file with its original content type. Restricted to `ADMIN`, whoever uploaded that item, or whoever raised the dispute it belongs to — `403 FORBIDDEN` otherwise |
| `POST` | `/api/v1/transactions/build/raise-dispute` | Unsigned XDR for `dispute_resolution_contract.raise_dispute` — sender or recipient |
| `POST` | `/api/v1/transactions/build/add-evidence-hash` | Unsigned XDR for `add_evidence_hash` — sender or recipient, `evidenceHash` must be a 32-byte hex string |
| `POST` | `/api/v1/transactions/build/resolve-dispute-refund-sender` | Unsigned XDR for `resolve_dispute_refund_sender` — admin only |
| `POST` | `/api/v1/transactions/build/resolve-dispute-pay-driver` | Unsigned XDR for `resolve_dispute_pay_driver` — admin only |
| `POST` | `/api/v1/transactions/build/resolve-dispute-split-funds` | Unsigned XDR for `resolve_dispute_split_funds` — admin only, `{ senderShareBps }` (0–10000) |

Same auth/config-fallback rules as escrow/deliveries: every `/transactions/build/*` and evidence-upload/download endpoint requires authentication, and the build endpoints return `502 BLOCKCHAIN_ERROR` if `DISPUTE_RESOLUTION_CONTRACT_ID` isn't configured. `escrow_contract`'s own `raise_dispute`/`resolve_dispute`/`resolve_dispute_split` (Layer A) and `delivery_contract`'s own `raise_dispute` (the intermediate leg `dispute_resolution_contract.raise_dispute` calls internally, `PHASE_1_DOMAIN_ANALYSIS.md` §10's call graph) are deliberately **not** exposed anywhere in this API — this module owns the one client-facing `POST /transactions/build/raise-dispute` endpoint for the full two-layer flow (`PHASE_1_DOMAIN_ANALYSIS.md` §5), and the `escrow`/`deliveries` modules' own endpoints intentionally omit their versions of it.

**Encoding caveat**: same as escrow/deliveries above — `disputes-scval-mapping.ts` encodes/decodes `dispute_resolution_contract`'s `DisputeCase`/`DisputeStatus` types by construction and round-trip only, not yet against a live deployment. One dispute-specific note: `delivery_id` is the **tuple-wrapped `DeliveryId`** struct for every `dispute_resolution_contract` call, unlike `escrow_contract`'s bare `u64` — verified directly against `dispute_resolution_contract/lib.rs`.

**Read-model gaps** (see `EVENT_INDEXER.md` for the full event-to-state mapping): `senderShareBps` is always `null` — `dispute_resolved_split`'s event payload is just `(caller, delivery_id)` and the on-chain `DisputeCase` itself has no such field, so this backend has no source to sync it from. A dispute raised and resolved purely through `escrow_contract`'s Layer A (never touching `dispute_resolution_contract`) stays `OPEN` in this read model indefinitely — `escrow_contract.dispute_resolved` is ambiguous by itself (same fact the `escrow` module's own docs note) and this module has no fallback read to disambiguate it, unlike `escrow`'s own handler. Evidence `confirmedOnChain` is `false` for every item whenever no on-chain `DisputeCase` exists at all (same Layer-A-only scenario) — not an error, just nothing to confirm against.

**Evidence access control (Phase 6 security fix)**: `GET /disputes/:chainDeliveryId` is a public route (mirrors on-chain state, like every other module's single-resource `GET`) and its evidence list includes each item's `id` — so unlike most resources here, an evidence *id* is not itself a meaningful access boundary. Upload and download were both fixed in Phase 6 to actually check who's making the request: upload requires the caller to own (via a linked wallet) the `uploadedBy` address they're attributing the file to, and download requires the caller to be `ADMIN`, the uploader, or the dispute's raiser. Before this fix, any authenticated user could upload to or download from any dispute regardless of involvement.

| `GET` | `/api/v1/drivers/:address/reputation` | Get one driver's canonical reputation profile — `reputationScore`, `tier` (`BRONZE`/`SILVER`/`GOLD`, derived from score), `kycVerified`, `deliveriesCompleted`, plus `legacyDeliveriesCompleted` (a clearly-labeled secondary/informational counter, see below). `404` if the driver has never called `register_driver` |
| `POST` | `/api/v1/transactions/build/register-driver` | Unsigned XDR for `identity_reputation_contract.register_driver` — `{ driverAddress }`, driver self-registers |
| `POST` | `/api/v1/transactions/build/update-driver-kyc-status` | Unsigned XDR for `update_driver_kyc_status` — admin only, `{ adminAddress, driverAddress, kycVerified }` |

`increase_reputation`/`decrease_reputation` have no build endpoint at all — both require the on-chain *caller* to be the wired `delivery_contract`/`dispute_resolution_contract` address itself (`PHASE_1_DOMAIN_ANALYSIS.md` §7), not a wallet-signed transaction any user or admin could build; they're indexer-only concerns. `register_user` is similarly excluded — this module's schema (frozen in Phase 4) has a read model for driver reputation only, not the on-chain `UserProfile` that call creates.

**Two reputation ledgers, deliberately not conflated** (`PHASE_1_DOMAIN_ANALYSIS.md` §4/§12): `reputationScore`/`tier`/`deliveriesCompleted` are sourced exclusively from `identity_reputation_contract` — the canonical ledger. `legacyDeliveriesCompleted` is `delivery_contract`'s own, entirely separate `DriverProfile.deliveries_completed` counter, refreshed opportunistically (via a supplementary read, alongside every canonical-profile refresh) purely for transparency/debugging — **never** used for tier/ranking/eligibility decisions, and can lag behind actual delivery confirmations since `delivery_contract` doesn't emit a dedicated event for it.

**Encoding caveat**: same as escrow/deliveries/disputes above — `reputation-scval-mapping.ts` encodes/decodes `identity_reputation_contract`'s `DriverProfile` type by construction and round-trip only, not yet against a live deployment.

**Tier derivation**: `tier` has no on-chain event or field of its own — it's derived off-chain, in `sync-reputation-from-event.ts`, purely as a function of `reputationScore`: BRONZE below 50, SILVER 50–74, GOLD 75 and above. These thresholds live in one named constant, `modules/reputation/domain/tier-thresholds.ts`'s `DRIVER_TIER_THRESHOLDS`, documented there as mirroring `identity_reputation_contract.get_driver_tier` exactly — if the contract's own thresholds ever change, that constant (and its boundary tests in `sync-reputation-from-event.spec.ts`) must change in the same PR, or the stored `tier`/this endpoint will silently disagree with the contract.

| `GET` | `/api/v1/notifications` | List the authenticated user's own notifications, newest first — optional `status` (`PENDING`/`SENT`/`FAILED`) and `limit` (default 20, max 100) query params |
| `GET` | `/api/v1/notifications/:id` | Get one notification by id — `404` if it doesn't exist, `403 FORBIDDEN` if it exists but belongs to a different user |

Both routes require authentication and are always scoped to `request.user.id` — there is no notion of an admin reading another user's notifications in this v1 slice (that would be a natural `admin` module addition later). Unlike every other module's read model, `notifications` rows aren't a mirror of on-chain state — they're generated as a side effect of `dispatchNotificationsFromEvent` reacting to *other* modules' blockchain events; see `EVENT_INDEXER.md` for exactly which events produce a notification (a deliberately narrow set — only events whose payload names an actor address directly) and `DATABASE.md` for why this module reads the shared `users`/`wallet_addresses` tables directly. No `POST`/build endpoints — there's nothing on-chain to build a transaction for. `channel` is always `EMAIL` for v1 (`ARCHITECTURE.md` §4: SMS/push are documented future work); the default `NotificationSender` logs instead of sending real email, the same genuinely-functional-dev-default pattern `auth`'s `Mailer` already established (`AUTHENTICATION.md`) — swap in a real provider behind the same port when one is needed.

| `GET` | `/api/v1/analytics/gmv` | Gross merchandise value — total `RELEASED` escrow amount, grouped **by token** (`[{ token, releasedAmount, releasedCount }]`); never summed across tokens, since different Soroban tokens are different units of value |
| `GET` | `/api/v1/analytics/completion-rate` | `{ totalDeliveries, deliveredCount, completionRate }` — `completionRate` is a fraction in `[0, 1]`, `0` (not `NaN`) when there are no deliveries yet |
| `GET` | `/api/v1/analytics/dispute-rate` | `{ totalDeliveries, disputedCount, disputeRate }` — counts every delivery *ever* disputed (one `disputes` row per delivery), not a snapshot of deliveries currently `DISPUTED` (a resolved dispute moves on to `DELIVERED`/`CANCELLED`, so a status-snapshot count would undercount) |
| `GET` | `/api/v1/analytics/driver-tiers` | `{ bronze, silver, gold, total }` — driver count per reputation tier |

All four require authentication **and** the `ADMIN` role (`403 FORBIDDEN` otherwise) — unlike other modules' single-resource `GET`s, which mirror public on-chain state "like a block explorer," these are value-added aggregate business metrics this backend computes, and GMV/dispute-rate in particular are platform-revenue-adjacent numbers a real deployment wouldn't want publicly exposed. No time-range filtering in this v1 slice — every figure is all-time; date-bucketed reporting is natural future work, not built speculatively ahead of a need for it. `analytics` reads `deliveries`/`escrows`/`disputes`/`driver_profiles` directly rather than through each owning module's use cases — the one module where that's the documented design (`ARCHITECTURE.md` §4/§10), not an exception to work around.

| `GET` | `/api/v1/fraud-detection/actors/:address` | Live rule-based risk assessment for one Stellar address — `{ address, flagged, signals: [{ ruleType, category, windowHours, threshold, count, triggered }] }`, one signal per v1 rule (`DELIVERY_CREATION_VELOCITY`, `ESCROW_RELEASE_VELOCITY`, `DISPUTE_RAISE_VELOCITY`). `flagged` is `true` if any signal is `triggered`. `ADMIN`-gated, same reasoning as `analytics` — exposing who's currently flagged is an internal risk-ops concern, not public information |

Every rule is evaluated fresh on every call against `ActorActivity`, a durable append-only per-actor activity log this module's own event handler writes to (`EVENT_INDEXER.md`) — no persisted "verdict" that could go stale. v1 thresholds are fixed constants (`application/assess-actor.ts`), not tuned against real traffic (none exists yet) or configurable — both documented future work alongside ML-based scoring (`ROADMAP.md` §9), not built speculatively ahead of a need for them. No "list all currently-flagged actors" endpoint in v1 — that would mean evaluating every actor with any logged activity on every call, which doesn't scale without a materialized/indexed approach this module doesn't build yet; only the single-actor lookup, matching how every other module started with single-resource `GET`s.

**Time base for rule windows**: `ActorActivity.occurredAt` is on-chain ledger close time (`event.closedAt`), not ingestion time. Rule semantics are "activity that happened on-chain in the last N hours," so the window's `now` reference must share that same on-chain time base rather than wall-clock `Date.now()` — otherwise indexer lag (`OBSERVABILITY.md`'s single most important operational signal) makes recently-ingested-but-old-on-chain-time activity fall outside a window it should be in. `assessActor` takes an injectable `Clock` (`domain/clock.ts`) for this; production wiring (`modules/fraud-detection/index.ts`) uses `createLedgerClock`, which derives `now` from the most recently ingested `blockchain_events` row's `ledger_closed_at`, falling back to wall-clock time only when no event has been ingested yet.

| `GET` | `/api/v1/admin/disputes` | Lists every `OPEN` dispute for review — `[{ chainDeliveryId, status, raisedBy, raisedAt, evidenceCount }]`, oldest-raised first |
| `POST` | `/api/v1/admin/users/:id/role` | Sets a user's role — `{ role }` (`CUSTOMER`/`COURIER`/`FLEET_MANAGER`/`ADMIN`); `404` for an unknown user id |
| `GET` | `/api/v1/admin/audit-log` | Lists `AuditLog` entries, newest first — optional `limit` (default 50, max 200) |

All three `ADMIN`-gated. `GET /admin/disputes` deliberately diverges from this doc's own earlier-planned `POST /admin/disputes/:deliveryId/resolve`: it's a **review list** — `disputes` already exposes the three actual resolve-transaction-build endpoints (`POST /transactions/build/resolve-dispute-*`, see the disputes section above), and an admin frontend calls those directly once armed with this list's context, rather than `admin` reimplementing a fourth, redundant path to the same on-chain calls. `POST /admin/users/:id/role` is off-chain-only (no on-chain equivalent — `role` lives solely in this backend's own `users` table) and writes one `AuditLog` row per call, success or not, with the acting admin's own email as `actorLabel` (looked up server-side, never trusted from the request) — visible immediately via `GET /admin/audit-log`. `admin` reads `disputes`'/`deliveries`' tables directly for its review list and the shared `users` table directly for role management — the same `ARCHITECTURE.md`-documented exception `analytics`/`notifications` already established, not a new one.

Everything else below is the **planned surface**, matching the module boundaries in `ARCHITECTURE.md` §4 — it will be filled in endpoint-by-endpoint as each module ships in Phase 5, not written speculatively ahead of the code that implements it.

## Planned Endpoint Families

| Module | Example routes |
|---|---|
| — | `POST /transactions/submit` (relay a signed XDR envelope, track confirmation) |

Full request/response schemas for each of these will be documented here as they're implemented — see `ROADMAP.md` §5 (Phase 5 module DoD requires an OpenAPI schema entry and a request/response example for every exposed endpoint before a module is considered done).
