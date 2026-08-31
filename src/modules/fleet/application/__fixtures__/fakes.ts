import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  ChainFleetRecord,
  Fleet,
  FleetContractReader,
  FleetDriver,
  FleetRepository,
  FleetTransactionBuilder,
  FleetWithDrivers,
} from '../../domain/index.js';

interface FleetRow extends Fleet {
  drivers: FleetDriver[];
}

export function createInMemoryFleetRepository(): FleetRepository & {
  seed(fleet: FleetWithDrivers): void;
} {
  const fleets = new Map<string, FleetRow>();
  const key = (chainFleetId: bigint): string => chainFleetId.toString();

  function toFleetWithDrivers(row: FleetRow): FleetWithDrivers {
    const drivers = row.drivers;
    const totalActiveDrivers = drivers.filter(
      (d) => d.status === 'ACTIVE' && d.removedAt === null,
    ).length;
    return { ...row, drivers, totalActiveDrivers };
  }

  return {
    seed(fleet) {
      fleets.set(fleet.chainFleetId.toString(), { ...fleet, drivers: [...fleet.drivers] });
    },
    async findByChainFleetId(chainFleetId) {
      const row = fleets.get(key(chainFleetId));
      return row ? toFleetWithDrivers(row) : null;
    },
    async create(record) {
      const fleet: FleetRow = {
        id: randomUUID(),
        ...record,
        createdAt: new Date(),
        updatedAt: new Date(),
        drivers: [],
      };
      fleets.set(key(fleet.chainFleetId), fleet);
      return fleet;
    },
    async updateTreasury(chainFleetId, treasuryAddress) {
      const row = fleets.get(key(chainFleetId));
      if (!row) return;
      row.treasuryAddress = treasuryAddress;
    },
    async inviteDriver(chainFleetId, driverAddress, invitedAt) {
      const row = fleets.get(key(chainFleetId));
      if (!row) return;
      row.drivers.push({
        id: randomUUID(),
        driverAddress,
        status: 'PENDING',
        invitedAt,
        acceptedAt: null,
        removedAt: null,
      });
    },
    async acceptInvite(chainFleetId, driverAddress, acceptedAt) {
      const row = fleets.get(key(chainFleetId));
      const driver = row?.drivers.find((d) => d.driverAddress === driverAddress);
      if (!driver) return;
      driver.status = 'ACTIVE';
      driver.acceptedAt = acceptedAt;
    },
    async removeDriver(chainFleetId, driverAddress, removedAt) {
      const row = fleets.get(key(chainFleetId));
      const driver = row?.drivers.find((d) => d.driverAddress === driverAddress);
      if (!driver) return;
      driver.removedAt = removedAt;
    },
  };
}

export function createFakeFleetContractReader(): FleetContractReader & {
  seedPayoutAddress(driverAddress: string, chainFleetId: bigint, payoutAddress: string): void;
} {
  const payoutAddresses = new Map<string, string>();
  const key = (driverAddress: string, chainFleetId: bigint): string =>
    `${driverAddress}:${chainFleetId.toString()}`;

  return {
    seedPayoutAddress(driverAddress, chainFleetId, payoutAddress) {
      payoutAddresses.set(key(driverAddress, chainFleetId), payoutAddress);
    },
    async getPayoutAddress(driverAddress, chainFleetId) {
      const payoutAddress = payoutAddresses.get(key(driverAddress, chainFleetId));
      if (!payoutAddress) {
        throw new Error(
          `No fake payout address seeded for ${driverAddress}/${chainFleetId.toString()}`,
        );
      }
      return payoutAddress;
    },
  };
}

export function createFakeFleetTransactionBuilder(): FleetTransactionBuilder {
  return {
    async buildRegisterFleet() {
      return 'unsigned-xdr:register-fleet';
    },
    async buildUpdateFleetTreasury() {
      return 'unsigned-xdr:update-fleet-treasury';
    },
    async buildAddDriverToFleet() {
      return 'unsigned-xdr:add-driver-to-fleet';
    },
    async buildAcceptFleetInvite() {
      return 'unsigned-xdr:accept-fleet-invite';
    },
    async buildRemoveDriverFromFleet() {
      return 'unsigned-xdr:remove-driver-from-fleet';
    },
  };
}

export function buildChainFleetRecord(overrides: Partial<ChainFleetRecord> = {}): ChainFleetRecord {
  return {
    chainFleetId: 1n,
    ownerAddress: 'GOWNER',
    treasuryAddress: 'GTREASURY',
    ...overrides,
  };
}

export function buildFleetDriver(overrides: Partial<FleetDriver> = {}): FleetDriver {
  return {
    id: randomUUID(),
    driverAddress: 'GDRIVER',
    status: 'PENDING',
    invitedAt: new Date(),
    acceptedAt: null,
    removedAt: null,
    ...overrides,
  };
}

export function buildFleetWithDrivers(overrides: Partial<FleetWithDrivers> = {}): FleetWithDrivers {
  const drivers = overrides.drivers ?? [];
  return {
    id: randomUUID(),
    ...buildChainFleetRecord(overrides),
    createdAt: new Date(),
    updatedAt: new Date(),
    drivers,
    totalActiveDrivers: drivers.filter((d) => d.status === 'ACTIVE' && d.removedAt === null).length,
    ...overrides,
  };
}

export function buildFleetEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'fleet',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['fleet_registered'],
    payload: ['1', 'GOWNER', 'GTREASURY'],
    closedAt: new Date(),
    ...overrides,
  };
}
