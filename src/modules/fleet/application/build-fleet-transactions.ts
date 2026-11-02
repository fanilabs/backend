import type {
  AcceptFleetInviteTxInput,
  AddDriverToFleetTxInput,
  FleetTransactionBuilder,
  RegisterFleetTxInput,
  RemoveDriverFromFleetTxInput,
  UpdateFleetTreasuryTxInput,
} from '../domain/index.js';
import { DriverAlreadyInFleetError } from '../domain/errors.js';

export interface BuildFleetTransactionsDeps {
  transactionBuilder: FleetTransactionBuilder;
  /** Optional read model used to reject duplicate driver invitations before
   * building an on-chain transaction. */
  fleetRepository?: {
    isDriverActiveInFleet(chainFleetId: bigint, driverAddress: string): Promise<boolean>;
  };
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

    buildAddDriverToFleetTransaction: async (input: AddDriverToFleetTxInput): Promise<string> => {
      if (deps.fleetRepository) {
        const alreadyActive = await deps.fleetRepository.isDriverActiveInFleet(
          input.chainFleetId,
          input.driverAddress,
        );
        if (alreadyActive) {
          throw new DriverAlreadyInFleetError(input.driverAddress, input.chainFleetId);
        }
      }
      return deps.transactionBuilder.buildAddDriverToFleet(input);
    },

    buildAcceptFleetInviteTransaction: (input: AcceptFleetInviteTxInput): Promise<string> =>
      deps.transactionBuilder.buildAcceptFleetInvite(input),

    buildRemoveDriverFromFleetTransaction: (input: RemoveDriverFromFleetTxInput): Promise<string> =>
      deps.transactionBuilder.buildRemoveDriverFromFleet(input),
  };
}
