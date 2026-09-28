import {
  addressToScVal,
  buildInvokeTransaction,
  simulateReadCall,
  type SorobanClient,
} from '../../../blockchain/index.js';
import type {
  ChainDeliveryRecord,
  DeliveryContractReader,
  DeliveryTransactionBuilder,
} from '../domain/index.js';
import {
  createDeliveryArgsToScVal,
  deliveryIdToScVal,
  nativeToChainDeliveryRecord,
} from './delivery-scval-mapping.js';

/**
 * Real implementation of both delivery-module contract ports, backed by the
 * shared resilient Soroban client. One class since both read and write
 * sides target the same `delivery_contract` and share the same
 * `contractId`/`client` — see delivery-scval-mapping.ts for the encoding
 * details and its verification caveat (no live FaniLab deployment to test
 * against yet).
 */
export function createSorobanDeliveryContractClient(
  client: SorobanClient,
  contractId: string,
): DeliveryContractReader & DeliveryTransactionBuilder {
  return {
    async getDelivery(chainDeliveryId): Promise<ChainDeliveryRecord> {
      const native = await simulateReadCall(client, {
        contractId,
        method: 'get_delivery',
        args: [deliveryIdToScVal(chainDeliveryId)],
      });
      return nativeToChainDeliveryRecord(native);
    },

    async buildCreateDelivery(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'create_delivery',
        args: createDeliveryArgsToScVal(input),
        sourceAddress: input.senderAddress,
      });
    },

    async buildAssignDriver(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'assign_driver',
        args: [
          addressToScVal(input.callerAddress),
          deliveryIdToScVal(input.chainDeliveryId),
          addressToScVal(input.driverAddress),
        ],
        sourceAddress: input.callerAddress,
      });
    },

    async buildMarkInTransit(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'mark_in_transit',
        args: [addressToScVal(input.driverAddress), deliveryIdToScVal(input.chainDeliveryId)],
        sourceAddress: input.driverAddress,
      });
    },

    async buildConfirmDelivery(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'confirm_delivery',
        args: [addressToScVal(input.recipientAddress), deliveryIdToScVal(input.chainDeliveryId)],
        sourceAddress: input.recipientAddress,
      });
    },

    async buildCancelDelivery(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'cancel_delivery',
        args: [addressToScVal(input.senderAddress), deliveryIdToScVal(input.chainDeliveryId)],
        sourceAddress: input.senderAddress,
      });
    },

    async buildRaiseDispute(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'raise_dispute',
        args: [addressToScVal(input.callerAddress), deliveryIdToScVal(input.chainDeliveryId)],
        sourceAddress: input.callerAddress,
      });
    },
  };
}
