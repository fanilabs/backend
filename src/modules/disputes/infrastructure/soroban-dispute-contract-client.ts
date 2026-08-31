import {
  buildInvokeTransaction,
  simulateReadCall,
  tupleStructToScVal,
  u64ToScVal,
  type SorobanClient,
} from '../../../blockchain/index.js';
import type {
  ChainDisputeCase,
  DisputeContractReader,
  DisputeTransactionBuilder,
} from '../domain/index.js';
import {
  addEvidenceHashArgsToScVal,
  nativeToChainDisputeCase,
  raiseDisputeArgsToScVal,
  resolveDisputeArgsToScVal,
  resolveDisputeSplitFundsArgsToScVal,
} from './disputes-scval-mapping.js';

/**
 * Real implementation of both dispute-module contract ports, backed by the
 * shared resilient Soroban client — mirrors
 * escrow/infrastructure/soroban-escrow-contract-client.ts. `get_dispute`
 * itself takes the tuple-wrapped `DeliveryId`, same as every mutating call
 * here (disputes-scval-mapping.ts), unlike `escrow_contract`'s bare-`u64`
 * convention.
 */
export function createSorobanDisputeContractClient(
  client: SorobanClient,
  contractId: string,
): DisputeContractReader & DisputeTransactionBuilder {
  return {
    async getDispute(chainDeliveryId): Promise<ChainDisputeCase> {
      const native = await simulateReadCall(client, {
        contractId,
        method: 'get_dispute',
        args: [tupleStructToScVal(u64ToScVal(chainDeliveryId))],
      });
      return nativeToChainDisputeCase(native, chainDeliveryId);
    },

    async buildRaiseDispute(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'raise_dispute',
        args: raiseDisputeArgsToScVal(input),
        sourceAddress: input.callerAddress,
      });
    },

    async buildAddEvidenceHash(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'add_evidence_hash',
        args: addEvidenceHashArgsToScVal(input),
        sourceAddress: input.callerAddress,
      });
    },

    async buildResolveDisputeRefundSender(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'resolve_dispute_refund_sender',
        args: resolveDisputeArgsToScVal(input),
        sourceAddress: input.callerAddress,
      });
    },

    async buildResolveDisputePayDriver(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'resolve_dispute_pay_driver',
        args: resolveDisputeArgsToScVal(input),
        sourceAddress: input.callerAddress,
      });
    },

    async buildResolveDisputeSplitFunds(input) {
      return buildInvokeTransaction(client, {
        contractId,
        method: 'resolve_dispute_split_funds',
        args: resolveDisputeSplitFundsArgsToScVal(input),
        sourceAddress: input.callerAddress,
      });
    },
  };
}
