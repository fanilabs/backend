import type { FleetContractReader } from '../domain/index.js';

export interface GetPayoutAddressDeps {
  contractReader: FleetContractReader;
}

export interface GetPayoutAddressInput {
  chainFleetId: bigint;
  driverAddress: string;
}

/** A live RPC read, not a DB lookup — see `FleetContractReader`'s header
 * comment for why `get_payout_address` has no corresponding event to sync
 * from a read model instead. */
export function createGetPayoutAddressUseCase(deps: GetPayoutAddressDeps) {
  return async function getPayoutAddress(input: GetPayoutAddressInput): Promise<string> {
    return deps.contractReader.getPayoutAddress(input.driverAddress, input.chainFleetId);
  };
}
