import type { ChainFleetRecord, Fleet, FleetWithDrivers } from './entities.js';

/**
 * The read model — written exclusively by `syncFleetFromEvent` reacting to
 * confirmed on-chain events, same rule as every other module's repository.
 * Driver-scoped methods take `chainFleetId` (not the local `Fleet.id`) since
 * that's the only identifier the indexer's events ever carry; the Prisma
 * implementation resolves the local fleet row internally.
 */
export interface FindFleetOptions {
  /** When `false` (the default), the returned `drivers` list is filtered to
   * `removedAt === null` in the query itself, not in memory — see
   * `prisma-fleet-repository.ts`. `totalActiveDrivers` is unaffected either
   * way; it's always computed from the full, unfiltered membership. */
  includeRemoved?: boolean;
  /** Caps how many driver rows the `drivers` array can contain — a
   * long-lived fleet's full membership history is otherwise unbounded. */
  driverLimit?: number;
}

export interface FleetRepository {
  findByChainFleetId(
    chainFleetId: bigint,
    options?: FindFleetOptions,
  ): Promise<FleetWithDrivers | null>;
  create(record: ChainFleetRecord): Promise<Fleet>;
  updateTreasury(chainFleetId: bigint, treasuryAddress: string): Promise<void>;
  inviteDriver(chainFleetId: bigint, driverAddress: string, invitedAt: Date): Promise<void>;
  acceptInvite(chainFleetId: bigint, driverAddress: string, acceptedAt: Date): Promise<void>;
  removeDriver(chainFleetId: bigint, driverAddress: string, removedAt: Date): Promise<void>;
}

/**
 * Unlike deliveries/escrow, no `fleet_management_contract` event has a
 * sparse payload that needs hydrating via a supplementary read call — every
 * event carries everything `syncFleetFromEvent` needs directly. The one
 * read this module genuinely needs live is `get_payout_address`: it's a
 * derived on-chain view (fleet treasury if the driver is an active member,
 * otherwise the driver's own address) with no corresponding event, and
 * other modules (escrow, when building `create_escrow`) need its current
 * value at transaction-build time, not a stale copy (ARCHITECTURE.md §4).
 */
export interface FleetContractReader {
  getPayoutAddress(driverAddress: string, chainFleetId: bigint): Promise<string>;
}

export interface RegisterFleetTxInput {
  ownerAddress: string;
  treasuryAddress: string;
}

export interface UpdateFleetTreasuryTxInput {
  ownerAddress: string;
  chainFleetId: bigint;
  treasuryAddress: string;
}

export interface AddDriverToFleetTxInput {
  callerAddress: string;
  chainFleetId: bigint;
  driverAddress: string;
}

export interface AcceptFleetInviteTxInput {
  chainFleetId: bigint;
  driverAddress: string;
}

export interface RemoveDriverFromFleetTxInput {
  callerAddress: string;
  chainFleetId: bigint;
  driverAddress: string;
}

/** Builds unsigned XDR for all five of `fleet_management_contract`'s
 * mutating calls (PHASE_1_DOMAIN_ANALYSIS.md §6 / fleet_management_contract/
 * lib.rs). `init`/`set_identity_contract` are deployment-time admin
 * operations, not exposed here — same rationale as escrow's admin-only
 * calls being out of this module's scope. */
export interface FleetTransactionBuilder {
  buildRegisterFleet(input: RegisterFleetTxInput): Promise<string>;
  buildUpdateFleetTreasury(input: UpdateFleetTreasuryTxInput): Promise<string>;
  buildAddDriverToFleet(input: AddDriverToFleetTxInput): Promise<string>;
  buildAcceptFleetInvite(input: AcceptFleetInviteTxInput): Promise<string>;
  buildRemoveDriverFromFleet(input: RemoveDriverFromFleetTxInput): Promise<string>;
}
