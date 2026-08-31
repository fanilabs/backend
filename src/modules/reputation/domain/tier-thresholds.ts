import type { DriverTier } from './entities.js';

/**
 * Mirrors `identity_reputation_contract::get_driver_tier` exactly
 * (FaniLab-SmartContract, `identity_reputation_contract/src/lib.rs`,
 * contract revision tagged `v1.0.0` — the same revision `ROADMAP.md` §13
 * and this module's `sync-reputation-from-event.ts` header comment already
 * reference for "no duplicated business logic"). If that contract's
 * thresholds ever change, this constant must change in the same PR — see
 * `sync-reputation-from-event.spec.ts`'s boundary tests, which pin the
 * exact edges (49/50/74/75) these numbers must keep satisfying.
 */
export const DRIVER_TIER_THRESHOLDS = {
  GOLD: 75,
  SILVER: 50,
} as const;

/** Pure function of `reputationScore` — see `DRIVER_TIER_THRESHOLDS`'s
 * header comment for the on-chain source these bands mirror. */
export function tierFromScore(score: number): DriverTier {
  if (score >= DRIVER_TIER_THRESHOLDS.GOLD) return 'GOLD';
  if (score >= DRIVER_TIER_THRESHOLDS.SILVER) return 'SILVER';
  return 'BRONZE';
}
