import type {
  AcceptFleetInviteTxInput,
  AddDriverToFleetTxInput,
  FleetTransactionBuilder,
  RegisterFleetTxInput,
  RemoveDriverFromFleetTxInput,
  UpdateFleetTreasuryTxInput,
} from '../domain/index.js';

export interface BuildFleetTransactionsDeps {
  transactionBuilder: FleetTransactionBuilder;
}

/** Five thin delegations to the `FleetTransactionBuilder` port — same
 * "no branching business logic, so one file not one per call" rationale as
 * the `deliveries`/`escrow` modules' equivalent files. */
export function createBuildFleetTransactionsUseCases(deps: BuildFleetTransactionsDeps) {
  return {
    buildRegisterFleetTransaction: (input: RegisterFleetTxInput): Promise<string> =>
      deps.transactionBuilder.buildRegisterFleet(input),

    buildUpdateFleetTreasuryTransaction: (input: UpdateFleetTreasuryTxInput): Promise<string> =>
      deps.transactionBuilder.buildUpdateFleetTreasury(input),

    buildAddDriverToFleetTransaction: (input: AddDriverToFleetTxInput): Promise<string> =>
      deps.transactionBuilder.buildAddDriverToFleet(input),

    buildAcceptFleetInviteTransaction: (input: AcceptFleetInviteTxInput): Promise<string> =>
      deps.transactionBuilder.buildAcceptFleetInvite(input),

    buildRemoveDriverFromFleetTransaction: (input: RemoveDriverFromFleetTxInput): Promise<string> =>
      deps.transactionBuilder.buildRemoveDriverFromFleet(input),
  };
}
