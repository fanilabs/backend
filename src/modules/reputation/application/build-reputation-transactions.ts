import type {
  RegisterDriverTxInput,
  ReputationTransactionBuilder,
  UpdateDriverKycStatusTxInput,
} from '../domain/index.js';

export interface BuildReputationTransactionsDeps {
  transactionBuilder: ReputationTransactionBuilder;
}

/** Two thin delegations to the `ReputationTransactionBuilder` port — same
 * "no branching business logic, so one file not one per call" rationale as
 * every other module's equivalent file. */
export function createBuildReputationTransactionsUseCases(deps: BuildReputationTransactionsDeps) {
  return {
    buildRegisterDriverTransaction: (input: RegisterDriverTxInput): Promise<string> =>
      deps.transactionBuilder.buildRegisterDriver(input),

    buildUpdateDriverKycStatusTransaction: (input: UpdateDriverKycStatusTxInput): Promise<string> =>
      deps.transactionBuilder.buildUpdateDriverKycStatus(input),
  };
}
