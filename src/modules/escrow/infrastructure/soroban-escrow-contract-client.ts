import { assertEscrowAmount } from '../../../shared/validation/i128.js';
import {
  addressToScVal,
  buildInvokeTransaction,
  simulateReadCall,
  u64ToScVal,
  type SorobanClient,
} from '../../../blockchain/index.js';
import { InsufficientFundsError } from '../../../shared/errors/index.js';
import type {
  ChainEscrowRecord,
  EscrowContractReader,
  EscrowTransactionBuilder,
} from '../domain/index.js';
import { createEscrowArgsToScVal, nativeToChainEscrowRecord } from './escrow-scval-mapping.js';

export interface SorobanEscrowContractClientOptions {
  getTokenBalance?: (
    client: SorobanClient,
    token: string,
    sender: string,
  ) => Promise<bigint | null>;
}

async function defaultGetTokenBalance(
  client: SorobanClient,
  token: string,
  sender: string,
): Promise<bigint | null> {
  try {
    const native = await simulateReadCall(client, {
      contractId: token,
      method: 'balance',
      args: [addressToScVal(sender)],
    });
    if (typeof native === 'bigint') return native;
    if (typeof native === 'string' || typeof native === 'number') return BigInt(native);
    return null;
  } catch (error) {
    if (error instanceof InsufficientFundsError) throw error;
    return null;
  }
}

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
  options?: SorobanEscrowContractClientOptions,
): EscrowContractReader & EscrowTransactionBuilder {
  const getTokenBalance = options?.getTokenBalance ?? defaultGetTokenBalance;

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
      assertEscrowAmount(input.amount);

      const balance = await getTokenBalance(client, input.token, input.senderAddress);
      if (balance !== null && balance < input.amount) {
        throw new InsufficientFundsError('Insufficient token balance to fund escrow', {
          currentBalance: balance.toString(),
          requiredAmount: input.amount.toString(),
          missingAmount: (input.amount - balance).toString(),
          token: input.token,
          senderAddress: input.senderAddress,
        });
      }

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
