import type { ChainDriverProfile, DriverProfile, DriverTier } from './entities.js';

export interface DriverProfileUpsertFields {
  reputationScore: number;
  tier: DriverTier;
  kycVerified: boolean;
  deliveriesCompleted: number;
  registeredAt: Date;
  /** Omitted (rather than forced to `0`) when the supplementary
   * `delivery_contract` read fails — see `sync-reputation-from-event.ts` —
   * so a transient read failure never regresses a previously-known value. */
  legacyDeliveriesCompleted?: number;
}

/** The read model — written exclusively by `syncReputationFromEvent`. */
export interface DriverProfileRepository {
  findByAddress(address: string): Promise<DriverProfile | null>;
  upsert(address: string, fields: DriverProfileUpsertFields): Promise<void>;
}

/** `identity_reputation_contract`'s only driver read — the canonical
 * ledger (PHASE_1_DOMAIN_ANALYSIS.md §12 decision). */
export interface ReputationContractReader {
  getDriverProfile(address: string): Promise<ChainDriverProfile>;
}

/**
 * `delivery_contract`'s own, separate `get_driver_profile` — the "legacy"
 * ledger. Deliberately its own narrow port, not merged into
 * `ReputationContractReader`, since it targets a different deployed
 * contract (`DELIVERY_CONTRACT_ID`, not `IDENTITY_REPUTATION_CONTRACT_ID`)
 * and this module only ever needs one field from it.
 */
export interface LegacyDriverProfileReader {
  getLegacyDeliveriesCompleted(address: string): Promise<number>;
}

export interface RegisterDriverTxInput {
  driverAddress: string;
}

export interface UpdateDriverKycStatusTxInput {
  adminAddress: string;
  driverAddress: string;
  kycVerified: boolean;
}

/**
 * Builds unsigned XDR for `identity_reputation_contract`'s only two
 * wallet-signed calls (PHASE_1_DOMAIN_ANALYSIS.md §7). `increase_reputation`/
 * `decrease_reputation` are deliberately excluded — both require the
 * *caller* to be the wired `delivery_contract`/`dispute_resolution_contract`
 * address itself, not a wallet-signed transaction any user or admin could
 * build; they're indexer-only concerns (`sync-reputation-from-event.ts`).
 * `register_user` is similarly excluded — this module's schema (frozen in
 * Phase 4) has no read model for the on-chain `UserProfile` it would create,
 * only for driver reputation.
 */
export interface ReputationTransactionBuilder {
  buildRegisterDriver(input: RegisterDriverTxInput): Promise<string>;
  buildUpdateDriverKycStatus(input: UpdateDriverKycStatusTxInput): Promise<string>;
}
