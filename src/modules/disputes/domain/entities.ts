import type { DisputeStatus, UserRole } from '@prisma/client';

export type { DisputeStatus, UserRole };

export interface Dispute {
  id: string;
  chainDeliveryId: bigint;
  status: DisputeStatus;
  raisedBy: string;
  raisedAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  /** Only ever known from a `resolve_dispute_split_funds` transaction's own
   * input — `dispute_resolved_split`'s event payload is just `(caller,
   * delivery_id)`, and `DisputeCase` itself has no such field either
   * (PHASE_1_DOMAIN_ANALYSIS.md §5), so this backend has no on-chain source
   * to sync it from and it stays `null` until a future contract revision
   * exposes it. A documented gap, not a guess. */
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
