import type {
  AddEvidenceHashTxInput,
  DisputeRepository,
  DisputeTransactionBuilder,
  RaiseDisputeTxInput,
  ResolveDisputeSplitFundsTxInput,
  ResolveDisputeTxInput,
} from '../domain/index.js';

export interface BuildDisputeTransactionsDeps {
  transactionBuilder: DisputeTransactionBuilder;
  /** Optional so every other build* call here stays a pure delegation with
   * no persistence dependency — only `buildResolveDisputeSplitFundsTransaction`
   * uses it, to record the proposed `senderShareBps` (backend issue #40).
   * Omitting it (e.g. in tests that don't care about that side effect)
   * simply skips the recording rather than throwing. */
  disputeRepository?: DisputeRepository;
}

/**
 * Creates the dispute transaction-building use cases backed by a transaction
 * builder. Each method delegates to the corresponding builder operation;
 * resolving a split-funds dispute also records the proposed sender share when
 * a repository is provided.
 *
 * @param deps - Transaction builder and optional dispute repository.
 * @returns Use cases for building dispute transactions.
 */
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

    buildResolveDisputeSplitFundsTransaction: async (
      input: ResolveDisputeSplitFundsTxInput,
    ): Promise<string> => {
      const xdr = await deps.transactionBuilder.buildResolveDisputeSplitFunds(input);
      await deps.disputeRepository?.recordProposedSenderShareBps(
        input.chainDeliveryId,
        input.senderShareBps,
      );
      return xdr;
    },
  };
}
