import type {
  CreateEscrowTxInput,
  EscrowTransactionBuilder,
  RefundEscrowTxInput,
  ReleaseEscrowTxInput,
} from '../domain/index.js';

export interface BuildEscrowTransactionsDeps {
  transactionBuilder: EscrowTransactionBuilder;
}

/**
 * Creates use cases for building escrow transaction envelopes.
 *
 * Each returned function delegates to the corresponding operation on the
 * `EscrowTransactionBuilder` port without adding business logic.
 *
 * @param deps - Dependencies used to build escrow transactions.
 * @returns Use cases for building create, release, and refund transactions.
 */
export function createBuildEscrowTransactionsUseCases(deps: BuildEscrowTransactionsDeps) {
  return {
    buildCreateEscrowTransaction: (input: CreateEscrowTxInput): Promise<string> =>
      deps.transactionBuilder.buildCreateEscrow(input),

    buildReleaseEscrowTransaction: (input: ReleaseEscrowTxInput): Promise<string> =>
      deps.transactionBuilder.buildReleaseEscrow(input),

    buildRefundEscrowTransaction: (input: RefundEscrowTxInput): Promise<string> =>
      deps.transactionBuilder.buildRefundEscrow(input),
  };
}
