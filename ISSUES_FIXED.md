# Issues fixed

Four backend correctness/reliability issues, each in its own commit on `main`.

## 1. Disputes stuck OPEN when resolved purely via escrow Layer A

`modules/disputes/application/sync-dispute-from-event.ts` previously ignored
`escrow_contract`'s `dispute_resolved` event entirely, because the event
alone doesn't say whether the outcome was a release or a refund. A dispute
raised and resolved purely through `escrow_contract` (Layer A), without
`dispute_resolution_contract` (Layer B) ever touching it, stayed `OPEN`
forever — visible indefinitely in `GET /api/v1/admin/disputes`, the public
dispute read, and analytics' dispute rate.

Fix: added a narrow `DisputeEscrowStateReader` port (mirrors reputation's
`LegacyDriverProfileReader` — a single-field read against a second, genuinely
different deployed contract) and a Soroban-backed implementation that reads
`escrow_contract.get_escrow`'s current `status`. `escrow.dispute_resolved`
now maps `RELEASED` → `RESOLVED_PAYOUT` and `REFUNDED` → `RESOLVED_REFUND`.
The mapping only ever applies while the dispute is still `OPEN`, so a prior
Layer B resolution is always authoritative and is never overwritten by a
later Layer A event. `docs/API_REFERENCE.md` and `docs/EVENT_INDEXER.md`
updated to remove the documented gap.

Files: `modules/disputes/domain/ports.ts`, `modules/disputes/domain/index.ts`,
`modules/disputes/application/sync-dispute-from-event.ts`,
`modules/disputes/infrastructure/soroban-escrow-state-reader.ts` (new),
`modules/disputes/infrastructure/index.ts`, `modules/disputes/index.ts`,
`docs/API_REFERENCE.md`, `docs/EVENT_INDEXER.md`.

## 2. Unbounded, unfiltered driver list on `GET /fleets/:chainFleetId`

`modules/fleet/infrastructure/prisma-fleet-repository.ts` returned every
driver row ever associated with a fleet — including soft-removed ones — with
no way to filter or bound the response. Every client had to reimplement the
`removedAt === null` filter that `FleetDriver`'s own doc comment says is
required for "currently in the fleet."

Fix: added `includeRemoved` (query string, default `false`) and
`driverLimit` (default `100`, max `500`) to a new `getFleetQuerySchema`. The
filter and limit are now applied in the Prisma query itself
(`where: { removedAt: null }`, `take: driverLimit`), not in memory.
`totalActiveDrivers` is computed from a separate, always-unfiltered
`fleetDriver.count` so it stays correct regardless of what the `drivers`
array contains. `docs/API_REFERENCE.md` updated.

Files: `modules/fleet/interface/schemas.ts`, `modules/fleet/interface/routes.ts`,
`modules/fleet/domain/ports.ts`, `modules/fleet/domain/index.ts`,
`modules/fleet/infrastructure/prisma-fleet-repository.ts`,
`modules/fleet/application/get-fleet.ts`, `docs/API_REFERENCE.md`.

## 3. Fleet write paths threw on replayed/out-of-order events instead of being idempotent

Within `prisma-fleet-repository.ts`, `create` used a bare `prisma.fleet.create`
(throws `P2002` on a replayed `fleet_registered`), `updateTreasury` used a
bare `prisma.fleet.update` (throws `P2025` for an unindexed fleet), and
`acceptInvite`/`removeDriver` used `prisma.fleetDriver.update`, which still
throws `P2025` if the driver row doesn't exist yet (e.g. `invite_accepted`
observed without a prior `driver_invited`). Since the indexer starts at the
chain tip with no backfill, an existing fleet's subsequent events are the
common case, not the edge case.

Fix: `create` is now an upsert keyed on `chainFleetId`. `updateTreasury` is
now an `updateMany` that logs at debug level instead of throwing when
nothing matches. `acceptInvite` and `removeDriver` are now upserts keyed on
`FleetDriver`'s full unique key `(fleetId, driverAddress)` — both events
carry that key on their own, so a driver row can be constructed correctly
even if the corresponding `driver_invited` was never observed. Every
fleet-not-found guard now logs at debug level instead of silently returning.

Files: `modules/fleet/infrastructure/prisma-fleet-repository.ts`.

## 4. `disputes.raised_by` could be poisoned with the literal string `'unknown'`

`upsertResolution` fell back through
`existing?.raisedBy ?? resolvedBy ?? 'unknown'` when a resolution event was
observed with neither a known prior raiser nor a caller address on the
resolution itself. That sentinel then flowed into the public dispute read,
the admin review list, and — critically — `downloadEvidence`'s authorisation
check (`isOwnedByUser(requesterId, dispute.raisedBy)`), a column every other
code path treats as a Stellar address.

Fix: removed the `'unknown'` fallback. When no valid `raisedBy` is
determinable, the upsert is skipped entirely with a `warn` log instead of
writing a non-address value. The response DTO's `raisedBy` is now
constrained to the same Stellar-address regex the request schemas already
use, so a bad value would fail loudly at the API boundary rather than being
served. Added a comment documenting the now-guaranteed invariant at
`downloadEvidence`'s raiser check.

Files: `modules/disputes/application/sync-dispute-from-event.ts`,
`modules/disputes/interface/schemas.ts`,
`modules/disputes/application/download-evidence.ts`.
