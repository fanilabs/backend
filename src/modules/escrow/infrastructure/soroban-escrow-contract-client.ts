import {
  addressToScVal,
  buildInvokeTransaction,
  simulateReadCall,
  u64ToScVal,
  type SorobanClient,
} from '../../../blockchain/index.js';
import type {
  ChainEscrowRecord,
  EscrowContractReader,
  EscrowTransactionBuilder,
} from '../domain/index.js';
import { createEscrowArgsToScVal, nativeToChainEscrowRecord } from './escrow-scval-mapping.js';

/**
 * Real implementation of both escrow-module contract ports, backed by the
 * shared resilient Soroban client — mirrors
 * deliveries/infrastructure/soroban-delivery-contract-client.ts. `delivery_id`
 * is a bare u64 for every `escrow_contract` call (see
 * escrow-scval-mapping.ts), unlike delivery_contract's tuple-wrapped id.
 */
export function createSorobanEscrowContractClient(
  client: SorobanClient,
  contractId: string,
): EscrowContractReader & EscrowTransactionBuilder {
  return {
    async getEscrow(chainDeliveryId): Promise<ChainEscrowRecord> {
      const native = await simulateReadCall(client, {
        contractId,
        method: 'get_escrow',
        args: [u64ToScVal(chainDeliveryId)],
      });
      return nativeToChainEscrowRecord(native, chainDeliveryId);
    },

    async buildCreateEscrow(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'create_escrow',
        args: createEscrowArgsToScVal(input),
        sourceAddress: input.senderAddress,
      });
    },

    async buildReleaseEscrow(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'release_escrow',
        args: [addressToScVal(input.callerAddress), u64ToScVal(input.chainDeliveryId)],
        sourceAddress: input.callerAddress,
      });
    },

    async buildRefundEscrow(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'refund_escrow',
        args: [addressToScVal(input.callerAddress), u64ToScVal(input.chainDeliveryId)],
        sourceAddress: input.callerAddress,
      });
    },
  };
}
