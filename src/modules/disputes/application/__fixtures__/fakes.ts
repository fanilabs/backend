import { randomUUID } from 'node:crypto';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type {
  ChainDisputeCase,
  Dispute,
  DisputeContractReader,
  DisputeRepository,
  DisputeTransactionBuilder,
  Evidence,
  EvidenceRepository,
  EvidenceStorage,
  WalletOwnershipRepository,
} from '../../domain/index.js';

export function createInMemoryDisputeRepository(): DisputeRepository & {
  seed(dispute: Dispute): void;
} {
  const disputes = new Map<string, Dispute>();
  const key = (chainDeliveryId: bigint): string => chainDeliveryId.toString();

  return {
    seed(dispute) {
      disputes.set(key(dispute.chainDeliveryId), dispute);
    },
    async findByChainDeliveryId(chainDeliveryId) {
      return disputes.get(key(chainDeliveryId)) ?? null;
    },
    async findById(id) {
      return [...disputes.values()].find((dispute) => dispute.id === id) ?? null;
    },
    async upsert(chainDeliveryId, fields) {
      const existing = disputes.get(key(chainDeliveryId));
      disputes.set(key(chainDeliveryId), {
        id: existing?.id ?? randomUUID(),
        chainDeliveryId,
        senderShareBps: existing?.senderShareBps ?? null,
        resolvedBy: existing?.resolvedBy ?? null,
        resolvedAt: existing?.resolvedAt ?? null,
        ...fields,
      });
    },
  };
}

export function createInMemoryEvidenceRepository(): EvidenceRepository & {
  seed(evidence: Evidence): void;
} {
  const rows: Evidence[] = [];
  return {
    seed(evidence) {
      rows.push(evidence);
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async listByDisputeId(disputeId) {
      return rows.filter((row) => row.disputeId === disputeId);
    },
    async create(record) {
      const evidence: Evidence = { id: randomUUID(), createdAt: new Date(), ...record };
      rows.push(evidence);
      return evidence;
    },
  };
}

export function createFakeEvidenceStorage(): EvidenceStorage & {
  seed(storageUrl: string, bytes: Buffer): void;
} {
  const files = new Map<string, Buffer>();
  return {
    seed(storageUrl, bytes) {
      files.set(storageUrl, bytes);
    },
    async save({ disputeId, bytes }) {
      const storageUrl = `fake://${disputeId}/${files.size}`;
      files.set(storageUrl, bytes);
      return { storageUrl };
    },
    async read(storageUrl) {
      const bytes = files.get(storageUrl);
      if (!bytes) throw new Error(`No fake file at ${storageUrl}`);
      return bytes;
    },
  };
}

export function createFakeDisputeContractReader(): DisputeContractReader & {
  seed(chainDeliveryId: bigint, record: ChainDisputeCase): void;
} {
  const records = new Map<string, ChainDisputeCase>();
  return {
    seed(chainDeliveryId, record) {
      records.set(chainDeliveryId.toString(), record);
    },
    async getDispute(chainDeliveryId) {
      const record = records.get(chainDeliveryId.toString());
      if (!record) throw new Error(`No fake chain case seeded for ${chainDeliveryId.toString()}`);
      return record;
    },
  };
}

export function createFakeWalletOwnershipRepository(): WalletOwnershipRepository & {
  seed(userId: string, address: string): void;
} {
  const owned = new Map<string, string>();
  return {
    seed(userId, address) {
      owned.set(address, userId);
    },
    async isOwnedByUser(userId, address) {
      return owned.get(address) === userId;
    },
  };
}

export function createFakeDisputeTransactionBuilder(): DisputeTransactionBuilder {
  return {
    async buildRaiseDispute() {
      return 'unsigned-xdr:raise-dispute';
    },
    async buildAddEvidenceHash() {
      return 'unsigned-xdr:add-evidence-hash';
    },
    async buildResolveDisputeRefundSender() {
      return 'unsigned-xdr:resolve-dispute-refund-sender';
    },
    async buildResolveDisputePayDriver() {
      return 'unsigned-xdr:resolve-dispute-pay-driver';
    },
    async buildResolveDisputeSplitFunds() {
      return 'unsigned-xdr:resolve-dispute-split-funds';
    },
  };
}

export function buildDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: randomUUID(),
    chainDeliveryId: 1n,
    status: 'OPEN',
    raisedBy: 'GSENDER',
    raisedAt: new Date('2026-01-01T00:00:00Z'),
    resolvedBy: null,
    resolvedAt: null,
    senderShareBps: null,
    ...overrides,
  };
}

export function buildChainDisputeCase(overrides: Partial<ChainDisputeCase> = {}): ChainDisputeCase {
  return {
    chainDeliveryId: 1n,
    status: 'OPEN',
    raisedBy: 'GSENDER',
    raisedAt: new Date('2026-01-01T00:00:00Z'),
    evidenceHashes: [],
    ...overrides,
  };
}

export function buildEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: randomUUID(),
    disputeId: randomUUID(),
    hash: 'a'.repeat(64),
    storageUrl: 'fake://storage/1',
    contentType: 'image/png',
    uploadedBy: 'GSENDER',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildDisputeResolutionEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'dispute-resolution',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    // dispute_resolution_contract's delivery_id is the tuple-wrapped
    // DeliveryId struct. Topic segments are always string[] on the envelope
    // (soroban-event-source.ts JSON-stringifies non-string segments), so
    // this arrives as '["1"]', not a native array — unlike escrow_contract's
    // bare u64 topic segment ('1').
    topic: ['dispute_raised', '["1"]'],
    payload: ['GSENDER', ['1']],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function buildEscrowDisputeEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'escrow',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['delivery_disputed', '1'],
    payload: ['GDISPUTER', '1700000000'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
