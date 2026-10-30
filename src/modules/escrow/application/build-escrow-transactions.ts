import { assertEscrowAmount } from '../../../shared/validation/i128.js';
import { InvalidEscrowStateError } from '../domain/errors.js';
import type {
  CreateEscrowTxInput,
  EscrowStatus,
  EscrowTransactionBuilder,
  RefundEscrowTxInput,
  ReleaseEscrowTxInput,
} from '../domain/index.js';

export interface BuildEscrowTransactionsDeps {
  transactionBuilder: EscrowTransactionBuilder;
  /**
   * Optional read model used to verify escrow state before building a refund
   * transaction. When provided, refunds are rejected for escrows that are no
   * longer eligible (e.g. already released or refunded).
   */
  getEscrowStatus?: (chainDeliveryId: string) => Promise<EscrowStatus>;
}

const REFUNDABLE_STATUSES: readonly EscrowStatus[] = ['LOCKED', 'PAUSED'];

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
    buildCreateEscrowTransaction: async (input: CreateEscrowTxInput): Promise<string> => {
      assertEscrowAmount(input.amount);
      return deps.transactionBuilder.buildCreateEscrow(input);
    },

    buildReleaseEscrowTransaction: (input: ReleaseEscrowTxInput): Promise<string> =>
      deps.transactionBuilder.buildReleaseEscrow(input),

    buildRefundEscrowTransaction: async (input: RefundEscrowTxInput): Promise<string> => {
      if (deps.getEscrowStatus) {
        const status = await deps.getEscrowStatus(input.chainDeliveryId);
        if (!REFUNDABLE_STATUSES.includes(status)) {
          throw new InvalidEscrowStateError('Escrow cannot be refunded in current status');
        }
      }
      return deps.transactionBuilder.buildRefundEscrow(input);
    },
  };
}
