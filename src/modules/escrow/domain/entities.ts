import type { EscrowStatus } from '@prisma/client';

export type { EscrowStatus };

export interface Escrow {
  id: string;
  chainDeliveryId: bigint;
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string;
  token: string;
  /**
   * Amount in the token's smallest unit, as an exact integer.
   *
   * Conversion invariants (see `src/shared/database/decimal.ts`):
   * - Persisted as Prisma `Decimal(39, 0)`; always a non-negative integer.
   * - Domain type is `bigint`; never convert through `Number`.
   * - All Decimal <-> BigInt conversions must use `prismaDecimalToBigInt`
   *   and `bigIntToPrismaDecimal` (fixed-point string validation).
   * - Must round-trip exactly up to `i128::MAX`
   *   (170141183460469231731687303715884105727, 39 digits).
   */
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
  /** Token accepted by ingestion policy, not email/wallet/KYC verification.
   * False includes unknown historical state; only true contributes to GMV. */
  isVerified: boolean;
}

/**
 * What a `get_escrow` read call actually returns — narrower than `Escrow`.
 * `escrow_contract`'s on-chain `EscrowRecord` (shared_types) has no
 * `platform_fee`, `released_at`, or `refunded_at` fields at all; those are
 * only ever observable from `escrow_released`/`escrow_refunded` event
 * payloads, never from a read call (PHASE_1_DOMAIN_ANALYSIS.md §3).
 */
export type ChainEscrowRecord = Omit<
  Escrow,
  'id' | 'platformFee' | 'releasedAt' | 'refundedAt' | 'isVerified'
> & {
  platformFee?: bigint | null;
  isVerified?: boolean;
};
