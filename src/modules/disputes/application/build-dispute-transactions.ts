import type {
  AddEvidenceHashTxInput,
  DisputeTransactionBuilder,
  RaiseDisputeTxInput,
  ResolveDisputeSplitFundsTxInput,
  ResolveDisputeTxInput,
} from '../domain/index.js';

export interface BuildDisputeTransactionsDeps {
  transactionBuilder: DisputeTransactionBuilder;
}

/** Five thin delegations to the `DisputeTransactionBuilder` port — same "no
 * branching business logic, so one file not one per call" rationale as the
 * `escrow`/`deliveries` modules' equivalent files. */
export function createBuildDisputeTransactionsUseCases(deps: BuildDisputeTransactionsDeps) {
  return {
    buildRaiseDisputeTransaction: (input: RaiseDisputeTxInput): Promise<string> =>
      deps.transactionBuilder.buildRaiseDispute(input),

    buildAddEvidenceHashTransaction: (input: AddEvidenceHashTxInput): Promise<string> =>
      deps.transactionBuilder.buildAddEvidenceHash(input),

    buildResolveDisputeRefundSenderTransaction: (input: ResolveDisputeTxInput): Promise<string> =>
      deps.transactionBuilder.buildResolveDisputeRefundSender(input),

    buildResolveDisputePayDriverTransaction: (input: ResolveDisputeTxInput): Promise<string> =>
      deps.transactionBuilder.buildResolveDisputePayDriver(input),

    buildResolveDisputeSplitFundsTransaction: (
      input: ResolveDisputeSplitFundsTxInput,
    ): Promise<string> => deps.transactionBuilder.buildResolveDisputeSplitFunds(input),
  };
}
