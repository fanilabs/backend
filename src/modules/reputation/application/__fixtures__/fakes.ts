import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  ChainDriverProfile,
  DriverProfile,
  DriverProfileRepository,
  LegacyDriverProfileReader,
  ReputationContractReader,
  ReputationTransactionBuilder,
} from '../../domain/index.js';

export function createInMemoryDriverProfileRepository(): DriverProfileRepository & {
  seed(profile: DriverProfile): void;
} {
  const profiles = new Map<string, DriverProfile>();

  return {
    seed(profile) {
      profiles.set(profile.address, profile);
    },
    async findByAddress(address) {
      return profiles.get(address) ?? null;
    },
    async upsert(address, fields) {
      const existing = profiles.get(address);
      profiles.set(address, {
        id: existing?.id ?? randomUUID(),
        address,
        legacyDeliveriesCompleted: existing?.legacyDeliveriesCompleted ?? 0,
        ...fields,
      });
    },
  };
}

export function createFakeReputationContractReader(): ReputationContractReader & {
  seed(address: string, profile: ChainDriverProfile): void;
} {
  const records = new Map<string, ChainDriverProfile>();
  return {
    seed(address, profile) {
      records.set(address, profile);
    },
    async getDriverProfile(address) {
      const record = records.get(address);
      if (!record) throw new Error(`No fake chain profile seeded for ${address}`);
      return record;
    },
  };
}

export function createFakeLegacyDriverProfileReader(): LegacyDriverProfileReader & {
  seed(address: string, deliveriesCompleted: number): void;
  failFor(address: string): void;
} {
  const counts = new Map<string, number>();
  const failing = new Set<string>();
  return {
    seed(address, deliveriesCompleted) {
      counts.set(address, deliveriesCompleted);
    },
    failFor(address) {
      failing.add(address);
    },
    async getLegacyDeliveriesCompleted(address) {
      if (failing.has(address)) throw new Error(`Simulated failure for ${address}`);
      return counts.get(address) ?? 0;
    },
  };
}

export function createFakeReputationTransactionBuilder(): ReputationTransactionBuilder {
  return {
    async buildRegisterDriver() {
      return 'unsigned-xdr:register-driver';
    },
    async buildUpdateDriverKycStatus() {
      return 'unsigned-xdr:update-driver-kyc-status';
    },
  };
}

export function buildDriverProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: randomUUID(),
    address: 'GDRIVER',
    reputationScore: 50,
    tier: 'SILVER',
    kycVerified: false,
    deliveriesCompleted: 0,
    legacyDeliveriesCompleted: 0,
    registeredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildChainDriverProfile(
  overrides: Partial<ChainDriverProfile> = {},
): ChainDriverProfile {
  return {
    address: 'GDRIVER',
    reputationScore: 50,
    deliveriesCompleted: 0,
    kycVerified: false,
    registeredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildReputationEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'identity-reputation',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['driver_registered'],
    payload: ['GDRIVER'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
