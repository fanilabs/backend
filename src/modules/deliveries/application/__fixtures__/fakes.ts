import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  ChainDeliveryRecord,
  Delivery,
  DeliveryContractReader,
  DeliveryRepository,
  DeliveryTransactionBuilder,
} from '../../domain/index.js';

export function createInMemoryDeliveryRepository(): DeliveryRepository & {
  seed(delivery: Delivery): void;
} {
  const deliveries = new Map<string, Delivery>();
  const key = (chainDeliveryId: bigint): string => chainDeliveryId.toString();

  return {
    seed(delivery) {
      deliveries.set(key(delivery.chainDeliveryId), delivery);
    },
    async findByChainId(chainDeliveryId) {
      return deliveries.get(key(chainDeliveryId)) ?? null;
    },
    async list(filter) {
      return [...deliveries.values()].filter((delivery) => {
        if (filter.senderAddress && delivery.senderAddress !== filter.senderAddress) return false;
        if (filter.recipientAddress && delivery.recipientAddress !== filter.recipientAddress) {
          return false;
        }
        if (filter.driverAddress && delivery.driverAddress !== filter.driverAddress) return false;
        if (filter.status && delivery.status !== filter.status) return false;
        return true;
      });
    },
    async create(record) {
      const delivery: Delivery = { id: randomUUID(), ...record };
      deliveries.set(key(delivery.chainDeliveryId), delivery);
      return delivery;
    },
    async updateStatus(chainDeliveryId, patch) {
      const existing = deliveries.get(key(chainDeliveryId));
      if (!existing) return;
      deliveries.set(key(chainDeliveryId), { ...existing, ...patch });
    },
  };
}

export function createFakeDeliveryContractReader(): DeliveryContractReader & {
  seed(chainDeliveryId: bigint, record: ChainDeliveryRecord): void;
} {
  const records = new Map<string, ChainDeliveryRecord>();
  return {
    seed(chainDeliveryId, record) {
      records.set(chainDeliveryId.toString(), record);
    },
    async getDelivery(chainDeliveryId) {
      const record = records.get(chainDeliveryId.toString());
      if (!record) throw new Error(`No fake chain record seeded for ${chainDeliveryId.toString()}`);
      return record;
    },
  };
}

export function createFakeDeliveryTransactionBuilder(): DeliveryTransactionBuilder {
  return {
    async buildCreateDelivery() {
      return 'unsigned-xdr:create-delivery';
    },
    async buildAssignDriver() {
      return 'unsigned-xdr:assign-driver';
    },
    async buildMarkInTransit() {
      return 'unsigned-xdr:mark-in-transit';
    },
    async buildConfirmDelivery() {
      return 'unsigned-xdr:confirm-delivery';
    },
    async buildCancelDelivery() {
      return 'unsigned-xdr:cancel-delivery';
    },
    async buildRaiseDispute() {
      return 'unsigned-xdr:raise-dispute';
    },
  };
}

export function buildChainDeliveryRecord(
  overrides: Partial<ChainDeliveryRecord> = {},
): ChainDeliveryRecord {
  return {
    chainDeliveryId: 1n,
    senderAddress: 'GSENDER',
    recipientAddress: 'GRECIPIENT',
    driverAddress: null,
    status: 'PENDING',
    origin: 'Lagos',
    destination: 'Accra',
    cargoCategory: 'GENERAL',
    weightGrams: 500,
    fragile: false,
    createdAtChain: new Date(),
    transitStartedAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

export function buildDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return { id: randomUUID(), ...buildChainDeliveryRecord(overrides), ...overrides };
}

export function buildDeliveryEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'delivery',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['delivery_created'],
    payload: ['1', 'GSENDER'],
    closedAt: new Date(),
    ...overrides,
  };
}
