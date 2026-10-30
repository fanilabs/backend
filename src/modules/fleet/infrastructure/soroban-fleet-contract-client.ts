import { Contract, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk';
import { getConfig } from '../../../shared/config/index.js';
import { DriverPayoutAddressNotFoundError } from '../domain/errors.js';
import {
  addressToScVal,
  buildInvokeTransaction,
  u64ToScVal,
  type SorobanClient,
} from '../../../blockchain/index.js';
import type { FleetContractReader, FleetTransactionBuilder } from '../domain/index.js';

/**
 * Real implementation of both fleet-module contract ports, backed by the
 * shared resilient Soroban client — mirrors
 * escrow/infrastructure/soroban-escrow-contract-client.ts. `fleet_id` is a
 * bare `u64` for every `fleet_management_contract` call (verified against
 * `pub type FleetId = u64` in fleet_management_contract/lib.rs), so there's
 * no tuple-struct wrapping to handle. No separate scval-mapping file: unlike
 * escrow/deliveries there's no struct to decode here — `get_payout_address`
 * returns a bare `Address`, which `scValToNative` already turns into a plain
 * string.
 */
export function createSorobanFleetContractClient(
  client: SorobanClient,
  contractId: string,
): FleetContractReader & FleetTransactionBuilder {
  return {
    async buildRegisterFleet(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'register_fleet',
        args: [addressToScVal(input.ownerAddress), addressToScVal(input.treasuryAddress)],
        sourceAddress: input.ownerAddress,
      });
    },

    async buildUpdateFleetTreasury(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'update_fleet_treasury',
        args: [
          addressToScVal(input.ownerAddress),
          u64ToScVal(input.chainFleetId),
          addressToScVal(input.treasuryAddress),
        ],
        sourceAddress: input.ownerAddress,
      });
    },

    async buildAddDriverToFleet(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'add_driver_to_fleet',
        args: [
          addressToScVal(input.callerAddress),
          u64ToScVal(input.chainFleetId),
          addressToScVal(input.driverAddress),
        ],
        sourceAddress: input.callerAddress,
      });
    },

    async buildAcceptFleetInvite(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'accept_fleet_invite',
        args: [u64ToScVal(input.chainFleetId), addressToScVal(input.driverAddress)],
        sourceAddress: input.driverAddress,
      });
    },

    async buildRemoveDriverFromFleet(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'remove_driver_from_fleet',
        args: [
          u64ToScVal(input.chainFleetId),
          addressToScVal(input.callerAddress),
          addressToScVal(input.driverAddress),
        ],
        sourceAddress: input.callerAddress,
      });
    },
    async getPayoutAddress(driverAddress, chainFleetId) {
      const account = await client.getAccount(driverAddress);
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: getConfig().STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          new Contract(contractId).call(
            'get_payout_address',
            addressToScVal(driverAddress),
            u64ToScVal(chainFleetId),
          ),
        )
        .setTimeout(60)
        .build();

      const simulation = await client.simulateTransaction(tx);
      if ('error' in simulation) {
        throw new Error(`get_payout_address simulation failed: ${simulation.error}`);
      }

      const retval = simulation.result?.retval;
      if (retval === undefined || retval === null) {
        throw new DriverPayoutAddressNotFoundError();
      }

      const native = scValToNative(retval);
      if (native === null || native === undefined) {
        throw new DriverPayoutAddressNotFoundError();
      }
      if (typeof native !== 'string') {
        throw new Error('Expected get_payout_address to return an Address-as-string');
      }
      return native;
    },
  };
}
