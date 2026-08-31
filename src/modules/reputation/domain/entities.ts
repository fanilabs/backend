import type { DriverTier } from '@prisma/client';

export type { DriverTier };

export interface DriverProfile {
  id: string;
  address: string;
  reputationScore: number;
  tier: DriverTier;
  kycVerified: boolean;
  deliveriesCompleted: number;
  /** `delivery_contract`'s own, entirely separate `DriverProfile` counter
   * (PHASE_1_DOMAIN_ANALYSIS.md §4/§12) — surfaced for transparency/debugging
   * only, never used for ranking or eligibility. See `ports.ts`'s
   * `LegacyDriverProfileReader` for why this is a distinct on-chain source. */
  legacyDeliveriesCompleted: number;
  registeredAt: Date;
}

/**
 * What `identity_reputation_contract.get_driver_profile` actually returns —
 * narrower than `DriverProfile`: no `tier` field on-chain at all (`tier` is
 * a pure derived getter, `get_driver_tier`, recomputed here rather than
 * fetched via an extra RPC call — see `sync-reputation-from-event.ts`), and
 * no `legacyDeliveriesCompleted` (a different contract entirely).
 */
export interface ChainDriverProfile {
  address: string;
  reputationScore: number;
  deliveriesCompleted: number;
  kycVerified: boolean;
  registeredAt: Date;
}
