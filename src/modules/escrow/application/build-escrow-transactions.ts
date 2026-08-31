import type {
  CreateEscrowTxInput,
  EscrowTransactionBuilder,
  RefundEscrowTxInput,
  ReleaseEscrowTxInput,
} from '../domain/index.js';

export interface BuildEscrowTransactionsDeps {
  transactionBuilder: EscrowTransactionBuilder;
}

/** Three thin delegations to the `EscrowTransactionBuilder` port — same
 * "no branching business logic, so one file not one per call" rationale as
 * the `deliveries` module's build-delivery-transactions.ts. */
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
