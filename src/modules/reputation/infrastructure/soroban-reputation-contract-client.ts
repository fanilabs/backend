import {
  addressToScVal,
  buildInvokeTransaction,
  simulateReadCall,
  type SorobanClient,
} from '../../../blockchain/index.js';
import type {
  ChainDriverProfile,
  ReputationContractReader,
  ReputationTransactionBuilder,
} from '../domain/index.js';
import {
  nativeToChainDriverProfile,
  registerDriverArgsToScVal,
  updateDriverKycStatusArgsToScVal,
} from './reputation-scval-mapping.js';

/**
 * Real implementation of both reputation-module contract ports, backed by
 * the shared resilient Soroban client — mirrors
 * escrow/infrastructure/soroban-escrow-contract-client.ts.
 */
export function createSorobanReputationContractClient(
  client: SorobanClient,
  contractId: string,
): ReputationContractReader & ReputationTransactionBuilder {
  return {
    async getDriverProfile(address): Promise<ChainDriverProfile> {
      const native = await simulateReadCall(client, {
        contractId,
        method: 'get_driver_profile',
        args: [addressToScVal(address)],
      });
      return nativeToChainDriverProfile(native);
    },

    async buildRegisterDriver(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'register_driver',
        args: registerDriverArgsToScVal(input),
        sourceAddress: input.driverAddress,
      });
    },

    async buildUpdateDriverKycStatus(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'update_driver_kyc_status',
        args: updateDriverKycStatusArgsToScVal(input),
        sourceAddress: input.adminAddress,
      });
    },
  };
}
