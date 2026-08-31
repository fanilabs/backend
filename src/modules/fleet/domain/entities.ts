import type { FleetDriverStatus } from '@prisma/client';
export type { FleetDriverStatus };

export interface Fleet {
  id: string;
  chainFleetId: bigint;
  ownerAddress: string;
  treasuryAddress: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ChainFleetRecord = Pick<Fleet, 'chainFleetId' | 'ownerAddress' | 'treasuryAddress'>;

export interface FleetDriver {
  id: string;
  driverAddress: string;
  status: FleetDriverStatus;
  invitedAt: Date;
  acceptedAt: Date | null;
  /**
   * On-chain `remove_driver_from_fleet` deletes the storage record entirely
   * — there is no `Removed` variant of `DriverFleetStatus`. This read model
   * keeps the row instead of deleting it (a soft delete, `status` left at
   * its last known value) so removal history survives for audit — callers
   * that need "currently in the fleet" must filter on `removedAt === null`.
   */
  removedAt: Date | null;
}

/** A fleet with its member list attached — what `GET /fleets/:chainFleetId`
 * returns. `totalActiveDrivers` is computed from `drivers`, not stored
 * separately, so it can never drift from the rows it's derived from
 * (unlike the on-chain `FleetProfile.total_active_drivers` counter, which
 * is a separate field the contract must remember to keep in sync). */
export interface FleetWithDrivers extends Fleet {
  drivers: FleetDriver[];
  totalActiveDrivers: number;
}
