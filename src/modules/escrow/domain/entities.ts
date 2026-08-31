import type { EscrowStatus } from '@prisma/client';

export type { EscrowStatus };

export interface Escrow {
  id: string;
  chainDeliveryId: bigint;
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string;
  token: string;
  amount: bigint;
  /** Only known once an `escrow_released` event has been observed — the
   * on-chain `EscrowRecord` itself doesn't carry this field, see
   * `ChainEscrowRecord`'s doc comment. */
  platformFee: bigint | null;
  status: EscrowStatus;
  disputedBy: string | null;
  disputedAt: Date | null;
  releasedAt: Date | null;
  refundedAt: Date | null;
  createdAtChain: Date;
}

/**
 * What a `get_escrow` read call actually returns — narrower than `Escrow`.
 * `escrow_contract`'s on-chain `EscrowRecord` (shared_types) has no
 * `platform_fee`, `released_at`, or `refunded_at` fields at all; those are
 * only ever observable from `escrow_released`/`escrow_refunded` event
 * payloads, never from a read call (PHASE_1_DOMAIN_ANALYSIS.md §3).
 */
export type ChainEscrowRecord = Omit<Escrow, 'id' | 'platformFee' | 'releasedAt' | 'refundedAt'>;
