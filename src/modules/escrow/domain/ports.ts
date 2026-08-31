import type { ChainEscrowRecord, Escrow, EscrowStatus } from './entities.js';

export interface EscrowStatusPatch {
  status: EscrowStatus;
  platformFee?: bigint;
  disputedBy?: string;
  disputedAt?: Date;
  releasedAt?: Date;
  refundedAt?: Date;
}

/** The read model — written exclusively by `syncEscrowFromEvent` reacting to
 * confirmed on-chain events, same rule as every other module's repository. */
export interface EscrowRepository {
  findByChainDeliveryId(chainDeliveryId: bigint): Promise<Escrow | null>;
  create(record: ChainEscrowRecord): Promise<Escrow>;
  updateStatus(chainDeliveryId: bigint, patch: EscrowStatusPatch): Promise<void>;
}

/**
 * `escrow_funded`'s event payload is `(sender, recipient, amount)` — no
 * token address — and `dispute_resolved`'s payload doesn't disambiguate
 * whether the outcome was a release or a refund (both `resolve_dispute`
 * branches emit the identical `dispute_resolved` event per
 * PHASE_1_DOMAIN_ANALYSIS.md §3). Both cases need this supplementary read
 * call to learn the actual current on-chain state.
 */
export interface EscrowContractReader {
  getEscrow(chainDeliveryId: bigint): Promise<ChainEscrowRecord>;
}

export interface CreateEscrowTxInput {
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string;
  chainDeliveryId: bigint;
  token: string;
  amount: bigint;
}

export interface EscrowIdTxInput {
  chainDeliveryId: bigint;
}

export interface ReleaseEscrowTxInput extends EscrowIdTxInput {
  callerAddress: string;
}

export interface RefundEscrowTxInput extends EscrowIdTxInput {
  callerAddress: string;
}

/**
 * Builds unsigned XDR for `escrow_contract`'s create/release/refund calls
 * (PHASE_1_DOMAIN_ANALYSIS.md §3). Admin-only dispute resolution and
 * escrow's own `raise_dispute` are deliberately out of scope here — they
 * belong to the future `disputes` module per ARCHITECTURE.md §4, which
 * owns the full two-layer dispute/arbitration flow, not this one.
 */
export interface EscrowTransactionBuilder {
  buildCreateEscrow(input: CreateEscrowTxInput): Promise<string>;
  buildReleaseEscrow(input: ReleaseEscrowTxInput): Promise<string>;
  buildRefundEscrow(input: RefundEscrowTxInput): Promise<string>;
}
