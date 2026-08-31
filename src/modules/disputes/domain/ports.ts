import type { ChainDisputeCase, Dispute, DisputeStatus, Evidence } from './entities.js';

export interface DisputeUpsertFields {
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
}

/**
 * The read model — written exclusively by `syncDisputeFromEvent`. Unlike
 * every other module's repository, this one has no `create`/`updateStatus`
 * split: `escrow_contract.raise_dispute` and
 * `dispute_resolution_contract.raise_dispute` both fire in the same
 * transaction for the common path (PHASE_1_DOMAIN_ANALYSIS.md §5/§10's call
 * graph), and the indexer gives no ordering guarantee between two different
 * contracts' events for the same delivery — so every write is an idempotent
 * upsert rather than an assumed create-then-update sequence.
 */
export interface DisputeRepository {
  findByChainDeliveryId(chainDeliveryId: bigint): Promise<Dispute | null>;
  /** Looked up by the evidence table's `disputeId` (the local UUID, not the
   * chain id) — added for `downloadEvidence`'s access check, see that
   * file's header comment. */
  findById(id: string): Promise<Dispute | null>;
  upsert(chainDeliveryId: bigint, fields: DisputeUpsertFields): Promise<void>;
}

export interface EvidenceRepository {
  findById(id: string): Promise<Evidence | null>;
  listByDisputeId(disputeId: string): Promise<Evidence[]>;
  create(record: Omit<Evidence, 'id' | 'createdAt'>): Promise<Evidence>;
}

/**
 * Stores/serves the evidence *files* — only the 32-byte hash ever lives
 * on-chain (`add_evidence_hash`), so the actual photo/document/chat-log is
 * entirely this backend's responsibility (PHASE_1_DOMAIN_ANALYSIS.md §5).
 * Deliberately storage-agnostic: `infrastructure/local-evidence-storage.ts`
 * backs it with the local filesystem for v1, so an S3-compatible adapter can
 * replace it later without touching application code.
 */
export interface EvidenceStorage {
  save(input: { disputeId: string; contentType: string; bytes: Buffer }): Promise<{
    storageUrl: string;
  }>;
  read(storageUrl: string): Promise<Buffer>;
}

/**
 * Backs `uploadEvidence`/`downloadEvidence`'s access checks — reads the
 * shared `wallet_addresses` table directly, the same documented exception
 * `notifications`'s `UserContactLookup` established (see that file's
 * header comment) rather than a new one. A row only ever exists once a
 * wallet has completed the challenge/signature flow (`users` module), so
 * "owned" here already implies verified — there's no unverified-but-
 * present state to additionally guard against.
 */
export interface WalletOwnershipRepository {
  isOwnedByUser(userId: string, address: string): Promise<boolean>;
}

/** `get_dispute` is the only on-chain read `dispute_resolution_contract`
 * exposes — used at read-time (`getDispute`) to cross-check locally stored
 * evidence hashes against what's actually confirmed on-chain, and nowhere
 * else (see `sync-dispute-from-event.ts`'s header comment for why the sync
 * path doesn't also depend on this). */
export interface DisputeContractReader {
  getDispute(chainDeliveryId: bigint): Promise<ChainDisputeCase>;
}

/** Mirrors `escrow_contract`'s own `EscrowState` enum — only the variants
 * `handleEscrowEvent`'s `dispute_resolved` fallback needs to distinguish. */
export type EscrowStatusForDispute = 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'PAUSED';

/**
 * Reads `escrow_contract`'s own current status directly — added to
 * disambiguate `escrow.dispute_resolved` (see `sync-dispute-from-event.ts`'s
 * header comment for the full rationale). Mirrors `reputation`'s
 * `LegacyDriverProfileReader`: a narrow port reading a single field off a
 * second, genuinely different deployed contract (`escrow_contract`, not
 * `dispute_resolution_contract`) rather than folding it into
 * `DisputeContractReader` above.
 */
export interface DisputeEscrowStateReader {
  getEscrowStatus(chainDeliveryId: bigint): Promise<EscrowStatusForDispute>;
}

export interface RaiseDisputeTxInput {
  callerAddress: string;
  chainDeliveryId: bigint;
}

export interface AddEvidenceHashTxInput {
  callerAddress: string;
  chainDeliveryId: bigint;
  /** Hex-encoded 32-byte content hash. */
  evidenceHash: string;
}

export interface ResolveDisputeTxInput {
  callerAddress: string;
  chainDeliveryId: bigint;
}

export interface ResolveDisputeSplitFundsTxInput extends ResolveDisputeTxInput {
  senderShareBps: number;
}

/**
 * Builds unsigned XDR for `dispute_resolution_contract`'s five mutating
 * calls (PHASE_1_DOMAIN_ANALYSIS.md §5). `escrow_contract`'s own
 * `raise_dispute`/`resolve_dispute`/`resolve_dispute_split` (Layer A) are
 * deliberately not exposed anywhere in this backend — `escrow`'s domain/ports.ts
 * already documents that the full two-layer dispute/arbitration flow belongs
 * here, in `disputes`, and this module owns only the richer Layer B contract.
 */
export interface DisputeTransactionBuilder {
  buildRaiseDispute(input: RaiseDisputeTxInput): Promise<string>;
  buildAddEvidenceHash(input: AddEvidenceHashTxInput): Promise<string>;
  buildResolveDisputeRefundSender(input: ResolveDisputeTxInput): Promise<string>;
  buildResolveDisputePayDriver(input: ResolveDisputeTxInput): Promise<string>;
  buildResolveDisputeSplitFunds(input: ResolveDisputeSplitFundsTxInput): Promise<string>;
}
