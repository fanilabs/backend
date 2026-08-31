import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  ChainEscrowRecord,
  Escrow,
  EscrowContractReader,
  EscrowRepository,
  EscrowTransactionBuilder,
} from '../../domain/index.js';

export function createInMemoryEscrowRepository(): EscrowRepository & {
  seed(escrow: Escrow): void;
} {
  const escrows = new Map<string, Escrow>();
  const key = (chainDeliveryId: bigint): string => chainDeliveryId.toString();

  return {
    seed(escrow) {
      escrows.set(key(escrow.chainDeliveryId), escrow);
    },
    async findByChainDeliveryId(chainDeliveryId) {
      return escrows.get(key(chainDeliveryId)) ?? null;
    },
    async create(record) {
      const escrow: Escrow = {
        id: randomUUID(),
        ...record,
        platformFee: null,
        releasedAt: null,
        refundedAt: null,
      };
      escrows.set(key(escrow.chainDeliveryId), escrow);
      return escrow;
    },
    async updateStatus(chainDeliveryId, patch) {
      const existing = escrows.get(key(chainDeliveryId));
      if (!existing) return;
      escrows.set(key(chainDeliveryId), { ...existing, ...patch });
    },
  };
}

export function createFakeEscrowContractReader(): EscrowContractReader & {
  seed(chainDeliveryId: bigint, record: ChainEscrowRecord): void;
} {
  const records = new Map<string, ChainEscrowRecord>();
  return {
    seed(chainDeliveryId, record) {
      records.set(chainDeliveryId.toString(), record);
    },
    async getEscrow(chainDeliveryId) {
      const record = records.get(chainDeliveryId.toString());
      if (!record) throw new Error(`No fake chain record seeded for ${chainDeliveryId.toString()}`);
      return record;
    },
  };
}

export function createFakeEscrowTransactionBuilder(): EscrowTransactionBuilder {
  return {
    async buildCreateEscrow() {
      return 'unsigned-xdr:create-escrow';
    },
    async buildReleaseEscrow() {
      return 'unsigned-xdr:release-escrow';
    },
    async buildRefundEscrow() {
      return 'unsigned-xdr:refund-escrow';
    },
  };
}

export function buildChainEscrowRecord(
  overrides: Partial<ChainEscrowRecord> = {},
): ChainEscrowRecord {
  return {
    chainDeliveryId: 1n,
    senderAddress: 'GSENDER',
    recipientAddress: 'GRECIPIENT',
    driverAddress: 'GDRIVER',
    token: 'GTOKEN',
    amount: 1_000_000n,
    status: 'LOCKED',
    disputedBy: null,
    disputedAt: null,
    createdAtChain: new Date(),
    ...overrides,
  };
}

export function buildEscrow(overrides: Partial<Escrow> = {}): Escrow {
  return {
    id: randomUUID(),
    ...buildChainEscrowRecord(overrides),
    platformFee: null,
    releasedAt: null,
    refundedAt: null,
    ...overrides,
  };
}

export function buildEscrowEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'escrow',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['escrow_funded', '1'],
    payload: ['GSENDER', 'GRECIPIENT', '1000000'],
    closedAt: new Date(),
    ...overrides,
  };
}
