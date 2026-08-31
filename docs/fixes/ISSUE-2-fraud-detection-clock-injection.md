# Issue 2: Align fraud-detection rule windows to a single time base

## Problem

`assessActor` computed its rule-window boundary from `Date.now()` (wall-clock
time), but `ActorActivity.occurredAt` is set from `event.closedAt`
(on-chain ledger close time). The two clocks only agree when the indexer
has zero lag. Under real indexer lag — documented in `docs/OBSERVABILITY.md`
as the single most important operational signal — recently-ingested events
carry older `occurredAt` values and could fall outside a rule window they
should be inside, or a backlog flush could pack many events into a window
they didn't really occur in.

## What changed

- Added `src/modules/fraud-detection/domain/clock.ts`: a `Clock` port
  (`now(): Promise<Date>`) and a `systemClock` fallback implementation.
  Documents the chosen semantics explicitly: rule windows mean "activity
  that happened *on-chain* in the last N hours," so the reference time must
  share `occurredAt`'s on-chain time base, not wall-clock time.
- Added `src/modules/fraud-detection/infrastructure/ledger-clock.ts`:
  `createLedgerClock(prisma)` derives `now` from the most recently ingested
  `blockchain_events` row's `ledger_closed_at`, falling back to wall-clock
  time only when no event has been ingested yet.
- `assess-actor.ts`'s `AssessActorDeps` now accepts an optional `clock`,
  defaulting to `systemClock` so existing callers are unaffected; the
  window boundary (`since`) is now computed from `clock.now()` instead of
  inlining `Date.now()`.
- `modules/fraud-detection/index.ts` (the module's composition root) wires
  the ledger-derived clock in production instead of the default.
- Added a `createFixedClock` test fixture and two new tests in
  `assess-actor.spec.ts` under indexer lag simulates lag with the injected
  clock, and a companion test asserts the pre-existing default-clock
  behavior would exclude the same activity if compared against real
  wall-clock time.
- Documented the time-base decision in `docs/API_REFERENCE.md`'s
  fraud-detection section.

## Why this is safe

`Clock` is optional and defaults to the prior wall-clock behavior, so no
existing caller or test needed to change. Only the module's own
composition root opts into the ledger-derived clock.
