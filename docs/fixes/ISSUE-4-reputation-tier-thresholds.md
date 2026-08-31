# Issue 4: De-duplicate driver tier thresholds

## Problem

`sync-reputation-from-event.ts` hardcoded the Bronze/Silver/Gold score
thresholds as a private local function (`tierFromScore`), duplicating
`identity_reputation_contract::get_driver_tier` with no shared constant, no
comment tying the numbers to a contract revision, and no boundary tests. A
future change to the contract's thresholds could silently drift from the
stored `tier` column and `GET /api/v1/drivers/:address/reputation`.

## What changed

- Added `src/modules/reputation/domain/tier-thresholds.ts`, exporting:
  - `DRIVER_TIER_THRESHOLDS` — a named constant (`{ GOLD: 75, SILVER: 50 }`)
    with a comment citing the exact contract source
    (`identity_reputation_contract::get_driver_tier`) and revision it
    mirrors.
  - `tierFromScore(score)` — the same pure derivation, now living in one
    place instead of being copied inline in the application layer.
- Re-exported both from `modules/reputation/domain/index.ts`.
- `sync-reputation-from-event.ts` now imports `tierFromScore` from the
  domain layer instead of defining its own copy; updated its header comment
  to point at the new constant.
- Added boundary-value tests to `sync-reputation-from-event.spec.ts` at the
  exact edges (`0`, `49`, `50`, `74`, `75`, `100`) asserting the derived
  tier at each one.
- Documented the derivation and its source in `docs/API_REFERENCE.md`'s
  reputation section.

## Why this is safe

`tierFromScore`'s behavior is unchanged — this is a pure refactor (move +
rename + test), not a threshold change. Existing tests
(`tier bands: <50 BRONZE, 50-74 SILVER, >=75 GOLD`) continue to pass
alongside the new boundary cases.
