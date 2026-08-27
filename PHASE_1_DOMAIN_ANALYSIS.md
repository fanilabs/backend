                    # Phase 1 — Domain & Smart Contract Analysis

**Status:** Complete
**Scope:** Study of `FaniLab-SmartContract` (local path: `../FaniLab-SmartContract`) as the business source of truth for `fanilab-backend`.
**Rule enforced:** No backend code was written in this phase. This document is the Phase 1 deliverable.

---

## 1. Business Domain

FaniLab is a blockchain-escrow logistics marketplace on Stellar Soroban, connecting **senders** (customers) with **drivers** (independent couriers or fleet-affiliated drivers) for point-to-point delivery of physical goods, with payment secured in an on-chain escrow and released automatically on confirmed delivery.

Core value proposition: replace trust between strangers with a smart contract. Money is locked when a delivery is created, moves through a strict delivery state machine, and is released, refunded, or split entirely by on-chain logic (with an admin arbitration path for disputes).

Primary actors (from contract code, not marketing copy):

| Role | On-chain identity | Capabilities |
|---|---|---|
| **Sender** | `Address` | Creates delivery + escrow, cancels (Pending only), raises disputes, receives refunds |
| **Recipient** | `Address` | Confirms delivery (triggers payout), raises disputes |
| **Driver** | `Address`, optional `DriverProfile` | Self-assigns or is assigned to a delivery, marks in-transit, receives payout (directly or via fleet treasury), accrues reputation |
| **Fleet Owner** | `Address` | Registers a fleet, invites/removes drivers, receives payouts on behalf of active fleet drivers via treasury address |
| **Admin** | `Address` (per-contract, not globally shared) | Fee configuration, dispute resolution, contract wiring, KYC verification, admin transfer |

There is **no on-chain concept of email, password, or session** — identity is a Stellar `Address` authenticated via `require_auth()`. All human-facing identity (accounts, roles, KYC documents, notifications) is necessarily an off-chain backend responsibility.

---

## 2. Contract Inventory

Seven crates, one shared library:

| Contract | File | Lines | Purpose |
|---|---|---|---|
| `shared_types` | `contracts/shared_types/lib.rs` | 584 | Common enums, structs, error codes, event topic helpers used across contracts |
| `escrow_contract` | `contracts/escrow_contract/lib.rs` | 547 | Locks/releases/refunds/splits funds; platform fee; admin transfer; settlement hook |
| `delivery_contract` | `contracts/delivery_contract/lib.rs` | 391 | Delivery state machine; driver assignment; calls escrow on confirm/cancel/dispute |
| `dispute_resolution_contract` | `contracts/dispute_resolution_contract/lib.rs` | 424 | Formal dispute case management, evidence hashes, multi-admin, orchestrates escrow + reputation |
| `fleet_management_contract` | `contracts/fleet_management_contract/lib.rs` | 380 | Fleet registration, driver invite/accept/remove, payout address resolution |
| `identity_reputation_contract` | `contracts/identity_reputation_contract/lib.rs` | 310 | User/driver profiles, KYC flag, reputation score, tiering |
| `settlement_contract` | `contracts/settlement_contract/src/lib.rs` | 18 | **Stub only** — see §7 |

No single "protocol registry" contract exists that links the others together; each contract is wired to its dependencies individually by admin calls (`set_settlement_contract`, `set_identity_contract`, `set_identity_reputation_contract`, delivery/escrow addresses passed at `init`). **The backend must persist this wiring itself** (which contract instance ID plays which role) since it isn't derivable from a single canonical source on-chain.

---

## 3. Escrow Lifecycle (authoritative, from `escrow_contract/lib.rs`)

### States (`EscrowState` / `EscrowStatus`)
`Locked → Released | Refunded | Paused`, `Paused → Released | Refunded`

### Functions and effects

| Function | Caller | Precondition | Effect |
|---|---|---|---|
| `init(admin, token, platform_fee_bps)` | deployer | not yet initialized | sets admin + `ProtocolConfig{token, platform_fee_bps, protocol_version=1}` |
| `create_escrow(sender, recipient, driver, delivery_id, token, amount)` | sender (`require_auth`) | no existing escrow for `delivery_id` | transfers `amount` from sender to contract; stores `EscrowRecord{status: Locked}`; emits `escrow_funded` |
| `release_escrow(caller, delivery_id)` | recipient or admin | status == Locked; contract token balance ≥ amount | fee = `amount * platform_fee_bps / 10000` (saturating); pays `amount - fee` to driver (via `payout_driver`, see below); fee to admin; status → Released; emits `escrow_released` |
| `refund_escrow(caller, delivery_id)` | sender or admin | status ∈ {Locked, Paused} | transfers full `amount` back to sender; status → Refunded; emits `escrow_refunded` |
| `raise_dispute(caller, delivery_id)` | sender or recipient | status == Locked | status → Paused; records `disputed_by`, `disputed_at`; emits `delivery_disputed` |
| `resolve_dispute(caller, delivery_id, release_to_driver: bool)` | admin only | status == Paused | branches to the same payout/refund logic as above; status → Released or Refunded; emits `dispute_resolved` |
| `resolve_dispute_split(caller, delivery_id, sender_share_bps)` | admin only | status == Paused; `sender_share_bps ≤ 10000` | splits `amount` between sender and driver by bps (no platform fee taken on split); **sets status to `Refunded` regardless of split ratio** — this is a state-machine quirk backend logic must not assume "Refunded ⇒ sender got 100%" |
| `freeze_funds(delivery_id)` | **anyone — no `require_auth` at all** | status == Locked | forces status → Paused. Callable by unauthenticated parties; in practice only invoked by `dispute_resolution_contract`, but nothing on-chain enforces that. Flag as a hardening item — see §8. |
| `propose_admin` / `accept_admin` | current/pending admin | — | two-step admin transfer, mirrors ADR-005 |
| `update_platform_fee(admin, new_fee_bps)` | admin | `new_fee_bps ≤ 1000` (10%) | updates fee; emits `FeeUpdated` |
| `set_settlement_contract(admin, addr)` | admin | — | wires optional settlement contract for payout currency conversion |
| Query fns | anyone | — | `get_admin`, `get_token`, `get_platform_fee`, `get_protocol_version`, `get_settlement_contract`, `get_escrow` |

**`payout_driver` behavior** (important for backend reconciliation): if a settlement contract is configured *and* the driver has a preferred asset registered *and* that asset differs from the escrow token, the escrow contract invokes `settlement_addr.execute_settlement_swap(...)` instead of a direct token transfer. The backend's ledger reconciliation logic must treat "driver paid" as a fact confirmed by the `escrow_released` event, not by a direct-transfer assumption — the actual settlement transaction is a **separate downstream cross-contract call** whose success/failure the escrow contract does not verify or roll back on (see §8 for risk).

### Errors (`EscrowError`, contract-local, distinct from `shared_types::FaniLabError`)
`InvalidState=1, DeliveryNotFound=2, InsufficientFunds=3, DuplicateDelivery=4, InvalidFee=5`. Note: `escrow_contract` mixes two error enums — `FaniLabError` (shared) for auth/init errors and `EscrowError` (local) for lifecycle errors. The backend's error-mapping layer needs both discriminant tables, disambiguated by which contract emitted them.

---

## 4. Delivery / Shipment Lifecycle (`delivery_contract/lib.rs`)

### States (`DeliveryStatus`)
Validated centrally by `validate_transition()`:
```
Pending   → Active, Cancelled
Active    → InTransit, Disputed, Cancelled
InTransit → Delivered, Disputed
Disputed  → Delivered, Cancelled
Delivered, Cancelled → terminal
```

### Functions

| Function | Caller | Effect |
|---|---|---|
| `init(admin, escrow_contract)` | deployer | wires the escrow contract address (single, hardcoded per instance — no multi-escrow support) |
| `create_delivery(sender, recipient, metadata: DeliveryMetadata)` | sender | increments a global counter for `DeliveryId`; stores record with status `Pending`; **does not itself call `create_escrow`** — escrow funding is a separate, uncoordinated transaction the frontend/backend must sequence correctly |
| `assign_driver(caller, delivery_id, driver)` | admin or the driver themself (self-assign) | Pending → Active |
| `mark_in_transit(driver, delivery_id)` | assigned driver only | Active → InTransit; records `transit_started_at` |
| `confirm_delivery(recipient, delivery_id)` | recipient only | InTransit → Delivered; records `delivered_at`; **cross-contract calls `escrow_contract.release_escrow`**; increments driver's `deliveries_completed` and `reputation_score` by 1 (a second, cruder reputation path than `identity_reputation_contract.increase_reputation` — see §8 inconsistency) |
| `cancel_delivery(sender, delivery_id)` | sender only | any non-terminal → Cancelled; cross-contract calls `escrow_contract.refund_escrow` |
| `raise_dispute(caller, delivery_id)` | sender or recipient | Active/InTransit → Disputed; cross-contract calls `escrow_contract.raise_dispute` **before** mutating local state (so a failed escrow call reverts the whole transaction — correct ordering) |
| `get_delivery` / `get_driver_profile` | anyone | reads |

**Important gap:** this contract keeps its *own* `DriverProfile` (`deliveries_completed`, `reputation_score`) that is entirely separate from `identity_reputation_contract`'s `DriverProfile`. Two independent reputation ledgers exist on-chain simultaneously with no synchronization. The backend must decide which one is authoritative for read models (recommendation to capture in Phase 3 design: treat `identity_reputation_contract` as canonical since it has richer semantics — tiers, KYC, enterprise eligibility — and treat `delivery_contract`'s counters as a legacy/redundant signal to index but not rank by).

**Error handling inconsistency:** unlike `escrow_contract`/`fleet_management_contract`/`identity_reputation_contract`, this contract does **not** use `#[contracterror]` + `panic_with_error!` for most paths — it uses bare `panic!("NotAuthorized")`, `panic!("DeliveryNotFound")`, `panic!("InvalidState")`, `panic!("EscrowNotConfigured")` string panics. These do not surface as typed Soroban error codes to clients; the backend's Soroban RPC error parser must pattern-match on panic message strings for this specific contract as a fallback, not rely solely on numeric discriminants.

---

## 5. Dispute Lifecycle — two layers exist

There are **two independent, only loosely-coordinated dispute mechanisms**:

**Layer A — `escrow_contract` built-in** (§3): `raise_dispute` / `resolve_dispute` / `resolve_dispute_split`. No evidence, no case record, single resolution call, admin = the escrow contract's own single admin address.

**Layer B — `dispute_resolution_contract`** (the "real" dispute system): a `DisputeCase{status, raised_at, raised_by, evidence_hashes: Vec<BytesN<32>>}` keyed by `delivery_id`.

- `init(admin, delivery_contract, escrow_contract, dispute_time_limit)` — wires dependencies and a claim window (seconds after `delivered_at` beyond which disputes on a *Delivered* order are rejected).
- `add_admin` / `remove_admin` — **multiple named admins** via `Map<Address, bool>` pattern (`DataKey::Admin(Address)`), unlike `escrow_contract`'s single-admin-with-succession model. Inconsistent governance model across contracts — Phase 3 design should decide whether the backend normalizes this (e.g. presents one unified "who can arbitrate this delivery" view) or surfaces the discrepancy per-contract.
- `raise_dispute(caller, delivery_id)`: fetches the delivery from `delivery_contract`, verifies caller is sender/recipient, branches on delivery status — if `Delivered`, checks the time limit; if `Active`/`InTransit`, cross-calls `delivery_contract.raise_dispute` (which itself cross-calls escrow); then unconditionally calls `escrow_contract.freeze_funds(delivery_id)`; creates the `DisputeCase` (`Open`).
- `add_evidence_hash(caller, delivery_id, hash: BytesN<32>)` — sender/recipient only, dispute must be `Open`. Only a 32-byte hash is stored on-chain — **actual evidence (photos, documents, chat logs) is explicitly off-chain**, making evidence storage/serving a first-class backend responsibility (content-addressed, hash-verifiable against this field).
- `resolve_dispute_refund_sender` / `resolve_dispute_split_funds` / `resolve_dispute_pay_driver` — admin-only, each transitions `DisputeCase.status` and cross-calls the escrow contract's corresponding lifecycle function. The refund path also cross-calls `identity_reputation_contract.decrease_reputation(driver, 10)` if an identity contract is wired — the split and payout paths do **not** touch reputation at all (asymmetric penalty logic worth flagging to product/business, not silently "fixing" in the backend).
- `get_dispute(delivery_id)` — read.

**Backend implication:** the indexer must track dispute state via **both** `dispute_raised`/`evidence_added`/`dispute_resolved_*` events from `dispute_resolution_contract` **and** `delivery_disputed`/`dispute_resolved` events from `escrow_contract`, and reconcile them into one dispute timeline per delivery, since neither contract alone tells the full story.

---

## 6. Fleet Management (`fleet_management_contract/lib.rs`)

- `init(admin)`, `set_identity_contract(admin, addr)` (optional wiring).
- `register_fleet(owner, treasury) -> FleetId`: increments counter, stores `FleetProfile{fleet_id, owner, treasury, total_active_drivers}`; if an identity contract is wired, auto-registers the owner as a driver via cross-call to `register_driver`.
- `add_driver_to_fleet(caller=owner, fleet_id, driver)`: owner-only invite, guards against re-inviting a `Pending`/`Active` driver.
- `accept_fleet_invite(fleet_id, driver)`: driver-signed acceptance, `Pending → Active`, increments `total_active_drivers`.
- `remove_driver_from_fleet(fleet_id, caller, driver)`: owner **or** the driver themself may sever the relationship; decrements the active count if applicable.
- `get_payout_address(driver, fleet_id) -> Address`: returns the fleet treasury if the driver is `Active` in that fleet, else the driver's own address.

**Critical integration gap:** `get_payout_address` is a **pure read function that nothing else calls automatically**. `escrow_contract.release_escrow` pays `record.driver` directly (via `payout_driver`) — it has **no knowledge of fleet management** and never calls `get_payout_address`. In other words, **fleet-routed payouts are not actually wired end-to-end on-chain today**. Whatever process creates the escrow record (`create_escrow`'s `driver: Address` parameter) must already resolve the correct payout address (driver vs. fleet treasury) *before* calling `create_escrow`, or fleet payout routing silently doesn't happen. This is exactly the kind of "missing/incomplete on-chain functionality" the task brief asks to be documented as future work rather than invented — the backend can and should surface fleet payout resolution as a *pre-transaction convenience API* (call `get_payout_address` and let the client pass the resolved address into `create_escrow`'s `driver` param), but cannot make the chain enforce it.

---

## 7. Identity & Reputation (`identity_reputation_contract/lib.rs`)

- Two initializer entry points exist: `init(admin)` (minimal) and `initialize(admin, delivery_contract, dispute_contract)` (full, `require_auth`'d). Both guard against double-init via the same `DataKey::Admin` flag, but only one should ever be called per deployed instance — worth flagging in deployment docs since calling `init` then expecting `initialize`'s wiring to exist will silently leave `DeliveryContract`/`DisputeContract` unset, and `increase_reputation`/`decrease_reputation` will then panic with `NotInitialized`.
- `set_authorized_contract` / `is_authorized_contract`: a generic allow-list flag stored per address but **it is never actually checked anywhere else in this contract** — `increase_reputation`/`decrease_reputation` instead hardcode the check against `DeliveryContract`/`DisputeContract` specifically. Dead/unused authorization primitive — do not build backend logic that assumes this list is enforced.
- `register_driver(driver)` / `register_user(user)`: self-registration, starting `reputation_score = 50` for drivers, one-time (errors `AlreadyInitialized` on re-registration attempt — a slightly misleading error name reused from the shared error enum for "already registered").
- `update_driver_kyc_status(admin, driver, kyc_verified: bool)`: admin-only flag flip. This is the **entire on-chain KYC model** — no document storage, no verification workflow, just a boolean. All actual KYC document collection/verification is necessarily an off-chain backend + third-party-provider responsibility, with only the final boolean pushed on-chain.
- `increase_reputation(caller, driver, delivery_id, weight_grams, fragile)`: caller must be the wired `delivery_contract` or `dispute_contract` address (**not `require_auth` on `driver` — auth is on `caller`**, i.e. only those two contracts can call this). Awards `5 + (3 if weight_grams > 5000) + (2 if fragile)` points, capped at `MAX_REPUTATION = 100`. **Never actually invoked by `delivery_contract`** in the current codebase — `delivery_contract.confirm_delivery` increments its own local, separate reputation counter instead (see §4). This function currently has no real caller path except being invocable directly by whichever contract was configured, so is effectively dead code today unless a contract is manually wired to call it.
- `decrease_reputation(caller, driver, points)`: same caller restriction; used by `dispute_resolution_contract.resolve_dispute_refund_sender` (`-10` points).
- `get_driver_tier`: Bronze (<50), Silver (50–74), Gold (≥75). `is_eligible_for_enterprise`: score ≥ `ENTERPRISE_THRESHOLD = 75`.

---

## 8. Settlement Contract — effectively unimplemented

`contracts/settlement_contract/src/lib.rs` is 18 lines: one function, `register_driver_preference(driver, asset)`, whose body is `todo!()` (an unconditional panic at runtime). No `execute_settlement_swap`, no `get_driver_preference`, no asset allow-list, no AMM/DEX integration exists in code — despite `escrow_contract::payout_driver` already containing dead-but-compiled call sites for both `get_driver_preference` and `execute_settlement_swap` on this contract, and despite `docs/architecture/smart-contract-architecture.md` and `docs/ARCHITECTURE_DECISION_RECORDS.md` (ADR-009) describing it as a real cross-border currency-conversion feature.

**This must be treated as future/unsupported work, not built around.** Per the task's explicit instruction, the backend must **not invent** settlement/currency-conversion behavior. Recommendation for later phases: the backend should model multi-currency payout preference as a **backend-only, off-chain field** (informational) until the settlement contract is actually implemented, and should not expose an API that claims to "swap currency on release" since the chain cannot currently honor it — calling `create_escrow`/`release_escrow` with a settlement contract configured today would revert at the `todo!()` panic the moment a driver's preferred asset differs from the escrow token.

---

## 9. Full Event Catalog (indexer surface)

These are the on-chain topics the backend's blockchain event indexer must subscribe to. Two publishing conventions coexist and the indexer needs to handle both:

**Structured (`shared_types::events::*` Symbol helpers, some with typed payload structs also defined in `shared_types`):**
`delivery_created`, `escrow_funded`, `driver_assigned`, `delivery_confirmed`, `escrow_released`, `delivery_disputed`, `escrow_refunded`, `dispute_resolved`

**Ad hoc (`Symbol::new(&env, "...")` inline, contract-local, no shared struct):**
- `escrow_contract`: `ProtocolInitialized`, `FeeUpdated`, `AdminTransferred`
- `delivery_contract`: `delivery_cancelled`, `DeliveryInTransit` (inconsistent casing vs. the rest — snake_case elsewhere, PascalCase here; the indexer's topic-matching must be exact-string, not case-normalized)
- `dispute_resolution_contract`: `dispute_raised`, `evidence_added`, `dispute_resolved_refund`, `dispute_resolved_split`, `dispute_resolved_payout` (note these are *more specific* than, and separate from, `escrow_contract`'s generic `dispute_resolved` — both fire on an admin dispute resolution and the indexer needs both to build one timeline, per §5)
- `fleet_management_contract`: `fleet_registered`, `fleet_treasury_updated`, `driver_invited`, `invite_accepted`, `driver_removed`
- `identity_reputation_contract`: `driver_registered`, `user_registered`, `kyc_status_updated`, `reputation_increased`, `reputation_decreased`

All contracts use the deprecated-but-functional `env.events().publish(...)` API (SDK 27 deprecation, explicitly `#[allow(deprecated)]`'d in every file) — not a backend concern directly, but worth noting for the "study every event" requirement: **event shapes are stable for now** but the deprecation signals a future Soroban SDK migration that could change the event subscription mechanism; the indexer should be built with a swappable event-source adapter rather than hardcoding today's RPC event-polling shape.

---

## 10. Cross-Contract Call Graph

```
delivery_contract.confirm_delivery   → escrow_contract.release_escrow
delivery_contract.cancel_delivery    → escrow_contract.refund_escrow
delivery_contract.raise_dispute      → escrow_contract.raise_dispute

dispute_resolution_contract.raise_dispute
    → delivery_contract.get_delivery
    → delivery_contract.raise_dispute (if Active/InTransit)   → escrow_contract.raise_dispute
    → escrow_contract.freeze_funds

dispute_resolution_contract.resolve_dispute_refund_sender
    → delivery_contract.get_delivery
    → identity_reputation_contract.decrease_reputation   (only if wired)
    → escrow_contract.resolve_dispute(release_to_driver=false)

dispute_resolution_contract.resolve_dispute_split_funds
    → escrow_contract.get_escrow
    → escrow_contract.resolve_dispute_split               (only if status==Paused)

dispute_resolution_contract.resolve_dispute_pay_driver
    → escrow_contract.resolve_dispute(release_to_driver=true)

fleet_management_contract.register_fleet
    → identity_reputation_contract.register_driver        (only if wired)

escrow_contract.release_escrow / resolve_dispute (release path)
    → settlement_contract.get_driver_preference            (only if wired — currently todo!())
    → settlement_contract.execute_settlement_swap          (only if wired and preference differs — currently todo!())
```

Nothing calls `fleet_management_contract` from `escrow_contract` or `delivery_contract` (§6 gap). Nothing calls `identity_reputation_contract.increase_reputation` from anywhere in the current codebase (§7 gap — dead code path).

---

## 11. Storage/Data Model Summary (for eventual read-model / Postgres schema design in Phase 3)

| Contract | Persistent keys | Notable |
|---|---|---|
| `escrow_contract` | `Escrow(DeliveryId) -> EscrowRecord`; instance: `Admin`, `ProtocolConfig`, `PendingAdmin`, `SettlementContract` | 30-day TTL (`518400` ledgers), auto-extended on every read/write |
| `delivery_contract` | `Delivery(DeliveryId) -> DeliveryRecord`; `DriverProfile(Address) -> DriverProfile` (contract-local, redundant — §4); instance: `Admin`, `EscrowContract`, persistent `DeliveryCounter` | same TTL policy |
| `dispute_resolution_contract` | `Dispute(DeliveryId) -> DisputeCase`; instance: `Admin(Address)` map, `DeliveryContract`, `EscrowContract`, `IdentityReputationContract`, `DisputeTimeLimit` | multi-admin via per-address flag, not a list type |
| `fleet_management_contract` | `Fleet(FleetId) -> FleetProfile`; `DriverFleet(FleetId, Address) -> DriverFleetStatus`; instance: `Admin`, `IdentityContract`, persistent `FleetCounter` | no reverse index "which fleets is this driver in" — O(n) off-chain only, another argument for a backend read model |
| `identity_reputation_contract` | `UserProfile(Address)`, `DriverProfile(Address)`, `AuthorizedContract(Address)` (unused, §7); instance: `Admin`, `DeliveryContract`, `DisputeContract` | |

All `DeliveryId`/amounts are `u64`/`i128`; `CargoCategory` is a closed enum (`Documents, Electronics, Perishables, Clothing, General`) — any backend schema for cargo type should mirror this enum exactly rather than inventing a broader taxonomy, to stay in sync with what the chain can actually represent.

---

## 12. Backend Responsibilities Implied by This Analysis

**Must do (complementing, not duplicating, on-chain logic):**
- Blockchain event indexer consuming the full catalog in §9, reconciling the two-layer dispute system (§5) and the two-layer reputation system (§4/§7) into single coherent read models.
- Off-chain identity: email/password or equivalent auth, session/JWT management, RBAC — the chain only ever sees a Stellar `Address`, so the backend owns the mapping from human account → address(es).
- KYC document collection/verification workflow, pushing only the final boolean to `identity_reputation_contract.update_driver_kyc_status`.
- Dispute evidence storage (images, documents) addressable by the 32-byte hash recorded in `dispute_resolution_contract.add_evidence_hash`.
- Fleet-aware payout resolution as a pre-transaction helper (§6), since the chain does not do this automatically.
- Notifications (delivery status changes, dispute updates, KYC results) driven off indexed events.
- Analytics/reporting (GMV, dispute rate, delivery completion rate — metrics explicitly named in the smart-contract README) computed from indexed data, since no contract exposes aggregate queries.
- Retry/reconciliation workers for failed or dropped Soroban transactions (submission ≠ inclusion; the backend needs its own transaction-status tracking independent of the chain's event stream).
- Fraud/anomaly detection — entirely a backend concern; nothing on-chain addresses this beyond reputation scores.

**Must NOT do:**
- Re-implement escrow fund custody, release, or refund logic — always call the deployed contracts, never move funds independently.
- Invent settlement/currency-swap behavior — the settlement contract is a stub (§8); do not build backend logic that assumes cross-currency payout works today.
- Assume `fleet_management_contract.get_payout_address` is automatically honored by escrow — it isn't (§6).
- Assume `identity_reputation_contract.increase_reputation` reflects real driver history — it's currently unreachable dead code; `delivery_contract`'s local counters are what's actually incremented today (§4).
- Treat `AuthorizedContract` allow-list in `identity_reputation_contract` as enforced anywhere (§7) — it's inert.

**Open questions for Phase 3 (design), not to be silently decided here:**
- Which reputation ledger becomes the backend's canonical read model, given two diverge on-chain (§4).
- Whether the backend normalizes the two admin-governance models (single-address-with-succession in `escrow_contract` vs. multi-address map in `dispute_resolution_contract`) into one "who can arbitrate" concept, or surfaces them separately.
- Multi-network/multi-instance support: nothing in the contracts prevents multiple deployed instances (e.g. per-region), and the backend's config model should decide up front whether it's single-deployment or must track a registry of contract IDs.

---

## 13. Note on Source-of-Truth Drift

The smart contract repository's own `README.md` still describes the backend as **"Node.js + Express.js + TypeScript + MongoDB"** and the top-level `FANILAB_PROJECT_OVERVIEW.md`/`EXECUTIVE_SUMMARY.md` documents in the parent directory describe the backend as optional/future ("Backend API (future)"). These predate and are superseded by the current task brief, which specifies Fastify + PostgreSQL + Prisma + Redis + BullMQ. This analysis proceeds on the current brief's stack; Phase 3/4 should note the discrepancy in the new repo's own docs so contributors aren't confused by the older sibling-repo documentation.

Similarly, `docs/API.md` in the smart contract repo advertises full API documentation for all seven contracts in its table of contents but its body only documents Escrow, Delivery, and Shared Types in detail — Dispute Resolution, Fleet Management, Identity Reputation, and Settlement are undocumented there. This analysis (§3–§8) fills that gap directly from source, and is more current/complete than `docs/API.md`.

---

## 14. Phase 1 Sign-off

This document satisfies the Phase 1 deliverable: business domain, escrow lifecycle, shipment/delivery lifecycle, dispute lifecycle, backend responsibilities, and blockchain integration points, all derived from the actual contract source rather than the (partially stale/incomplete) documentation layer. No backend code has been written.

**Next:** Phase 2 — study `SwiftChain_Backend` for engineering-quality patterns worth adopting/improving, per the task brief. Awaiting go-ahead before proceeding.
