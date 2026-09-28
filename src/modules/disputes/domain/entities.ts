import type { DisputeStatus, UserRole } from '@prisma/client';

export type { DisputeStatus, UserRole };

export interface Dispute {
  id: string;
  chainDeliveryId: bigint;
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  /** The account that owned the `raisedBy` *address* when this dispute was
   * first observed, captured once and never re-derived — see
   * `Dispute.raisedByUserId`'s doc comment (prisma/schema.prisma) and
   * `downloadEvidence`'s for the security rationale (raiser wallet-relink
   * evidence authorization). `null` if no account owned the address at
   * that moment, or for any dispute synced before this field existed. */
  raisedByUserId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  /** Set from `dispute_resolved_split`'s own confirmed event payload
   * (`(caller, delivery_id, sender_share_bps)`) once that event syncs —
   * see `sync-dispute-from-event.ts`'s `dispute_resolved_split` case. May
   * briefly hold a best-effort proposed value recorded at transaction-build
   * time before that (`DisputeRepository.recordProposedSenderShareBps`,
   * backend issue #40), and is `null` until either has happened.
   * `DisputeCase` itself has no such field (PHASE_1_DOMAIN_ANALYSIS.md §5),
   * so it is never available from a `get_dispute` read call. */
  senderShareBps: number | null;
}

export interface Evidence {
  id: string;
  disputeId: string;
  /** Hex-encoded 32-byte content hash — must match a `BytesN<32>` recorded
   * on-chain via `add_evidence_hash` for this evidence to be considered
   * verified (see `getDispute`'s `confirmedOnChain` flag). */
  hash: string;
  storageUrl: string;
  contentType: string;
  uploadedBy: string;
  /** The authenticated uploader's account id, captured once at upload time
   * — see `Evidence.uploadedByUserId`'s doc comment (prisma/schema.prisma)
   * and `downloadEvidence`'s. `null` only for evidence uploaded before this
   * field existed. */
  uploadedByUserId: string | null;
  createdAt: Date;
}

/**
 * What a `get_dispute` read call actually returns —
 * `dispute_resolution_contract`'s on-chain `DisputeCase`
 * (PHASE_1_DOMAIN_ANALYSIS.md §5). Narrower than `Dispute`: no
 * `resolvedBy`/`resolvedAt`/`senderShareBps` fields exist on-chain at all,
 * and evidence hashes live directly on the case as a `Vec<BytesN<32>>`
 * rather than as separate off-chain rows.
 */
export interface ChainDisputeCase {
  chainDeliveryId: bigint;
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  /** Hex-encoded, 32 bytes each. */
  evidenceHashes: string[];
}
