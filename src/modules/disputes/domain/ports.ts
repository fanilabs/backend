import type { ChainDisputeCase, Dispute, DisputeStatus, Evidence } from './entities.js';

export interface DisputeUpsertFields {
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  /** Only ever meaningful the *first* time a dispute row is created — see
   * `DisputeRepository.upsert`'s doc comment for why the repository itself
   * (not just callers) refuses to let this field touch an already-existing
   * row. Callers resolve it fresh on every `dispute_raised`/
   * `delivery_disputed` event regardless (cheap, and harmless since it's
   * discarded on the update path), rather than reading the dispute first
   * to decide whether to include it. */
  raisedByUserId?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  /** Only ever set from `dispute_resolved_split`'s own event payload — the
   * confirmed, authoritative value once the resolution is actually on
   * chain. See `DisputeRepository.recordProposedSenderShareBps` for the
   * earlier, best-effort value recorded at transaction-build time. */
  senderShareBps?: number;
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
  /**
   * `fields.raisedByUserId` (security: raiser wallet-relink evidence
   * authorization) is applied ONLY when this call creates a brand-new row
   * — never on an update to an already-existing dispute. This is the
   * repository's own responsibility, not just a discipline callers must
   * remember: `sync-dispute-from-event.ts` calls this on every
   * `dispute_raised`/`delivery_disputed` event including replays of an
   * already-synced dispute, and on every later resolution event too. If a
   * later call (a replay, or a resolution) could overwrite an
   * already-set `raisedByUserId`, a wallet relinked long after the dispute
   * was raised — followed by any later event touching that same dispute
   * row — would silently reassign historical raiser authorization to the
   * new owner, recreating the exact vulnerability this field exists to
   * close. Once set, it is therefore immutable for the row's lifetime.
   */
  upsert(chainDeliveryId: bigint, fields: DisputeUpsertFields): Promise<void>;
  /**
   * Records the `sender_share_bps` an admin is about to submit on-chain via
   * `resolve_dispute_split_funds`, at the moment the unsigned transaction is
   * built — before it's ever signed or confirmed (backend issue #40). This
   * is a best-effort, non-authoritative hint only: `upsert`'s own
   * `senderShareBps` (set once `dispute_resolved_split`'s confirmed event
   * payload syncs) is the source of truth and always wins, so this must
   * never run after that point in a way that could overwrite it with a
   * stale proposed value.
   *
   * A no-op/create-nothing case (no dispute row yet for this
   * `chainDeliveryId`) is expected to be unreachable in practice —
   * `resolve_dispute_split_funds` is only ever callable on-chain once a
   * dispute already exists and is `Paused`, which this backend always
   * observes via `dispute_raised`/`delivery_disputed` first.
   *
   * Must only ever write while the dispute is still `OPEN` — once resolved
   * (by `upsert`, from a confirmed event), that outcome is final, same rule
   * `handleEscrowOnlyResolution` already applies to Layer A's ambiguous
   * `dispute_resolved`. Otherwise a stray/duplicate call to build another
   * split-funds transaction after the real resolution already synced could
   * clobber the confirmed `senderShareBps` with an unconfirmed one.
   */
  recordProposedSenderShareBps(chainDeliveryId: bigint, senderShareBps: number): Promise<void>;
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
  /**
   * Reverse lookup used exactly once per dispute — by
   * `sync-dispute-from-event.ts`, at the moment a `dispute_raised`/
   * `delivery_disputed` event first creates a `Dispute` row — to resolve
   * `Dispute.raisedByUserId` (security: raiser wallet-relink evidence
   * authorization). Callers elsewhere must NOT use this to authorize
   * access at read/download time: doing so would just be the current-
   * wallet-ownership check this field exists to stop trusting, wearing a
   * different name.
   *
   * `asOf` is mandatory, not a convenience — the caller must always pass
   * the on-chain event's own `closedAt`, never "now". The indexer resumes
   * from a checkpoint after any downtime (`poll-contract-events.ts`), so a
   * `dispute_raised` event can be processed for the *first time* well after
   * it actually happened on-chain; without this cutoff, a wallet unlinked
   * from the real raiser and relinked to someone else in that gap would
   * resolve to the new owner on first creation, not just on a later
   * replay — the exact vulnerability `raisedByUserId` exists to close,
   * just reached through first-processing lag instead of a replay. Only a
   * wallet link whose `WalletAddress.verifiedAt` is at or before `asOf`
   * counts as owning the address then; `null` if none does (no linked
   * account at all, or the only link happened after `asOf`).
   */
  findOwnerByAddress(address: string, asOf: Date): Promise<string | null>;
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
