import type {
  AddEvidenceHashTxInput,
  DisputeRepository,
  DisputeTransactionBuilder,
  RaiseDisputeTxInput,
  ResolveDisputeSplitFundsTxInput,
  ResolveDisputeTxInput,
} from '../domain/index.js';
import { ValidationError } from '../../../shared/errors/index.js';

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
      if (
        !Number.isInteger(input.senderShareBps) ||
        input.senderShareBps < 0 ||
        input.senderShareBps > 10_000
      ) {
        throw new ValidationError('Sender share must be an integer between 0 and 10000 basis points');
      }

      const xdr = await deps.transactionBuilder.buildResolveDisputeSplitFunds(input);
      if (deps.disputeRepository) {
        const existing = await deps.disputeRepository.findByChainDeliveryId(input.chainDeliveryId);
        if (!existing || existing.status === 'OPEN') {
          await deps.disputeRepository.recordProposedSenderShareBps(
            input.chainDeliveryId,
            input.senderShareBps,
          );
        }
      }
      return xdr;
    },
  };
}
