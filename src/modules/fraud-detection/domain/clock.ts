/**
 * The time base fraud-detection rule windows are measured against.
 *
 * `ActorActivity.occurredAt` is set from `event.closedAt` (see
 * `record-actor-activity-from-event.ts`) — on-chain ledger close time, not
 * ingestion time. Rule semantics here are deliberately "activity that
 * happened on-chain in the last N hours," matching the on-chain timestamp
 * already stored, rather than "activity this backend observed in the last
 * N hours." Comparing that column against wall-clock `Date.now()` is only
 * correct when the indexer has zero lag; under real lag (`docs/
 * OBSERVABILITY.md`'s "single most important operational signal"), a
 * burst of just-ingested-but-old-on-chain-time activity would incorrectly
 * fall outside the window.
 *
 * `Clock` is an injectable port so `assessActor` can be driven by a fixed
 * time in tests (simulating lag deterministically) and, in production, by
 * a reference derived from on-chain time rather than wall-clock time.
 */
export interface Clock {
  now(): Promise<Date>;
}

/** Real wall-clock time. Kept only as a fallback for when no on-chain
 * reference time is available yet (e.g. before the indexer has processed
 * any events) — production wiring prefers a ledger-time-derived clock, see
 * `infrastructure/ledger-clock.ts`. */
export const systemClock: Clock = {
  now: () => Promise.resolve(new Date()),
};
