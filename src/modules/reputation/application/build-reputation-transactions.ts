import type {
  RegisterDriverTxInput,
  ReputationTransactionBuilder,
  UpdateDriverKycStatusTxInput,
} from '../domain/index.js';

export interface BuildReputationTransactionsDeps {
  transactionBuilder: ReputationTransactionBuilder;
}

/**
 * Creates use cases that delegate driver registration and KYC-status
 * transaction construction to the `ReputationTransactionBuilder` port.
 */
export function createBuildReputationTransactionsUseCases(deps: BuildReputationTransactionsDeps) {
  return {
    buildRegisterDriverTransaction: (input: RegisterDriverTxInput): Promise<string> =>
      deps.transactionBuilder.buildRegisterDriver(input),

    buildUpdateDriverKycStatusTransaction: (input: UpdateDriverKycStatusTxInput): Promise<string> =>
      deps.transactionBuilder.buildUpdateDriverKycStatus(input),
  };
}
