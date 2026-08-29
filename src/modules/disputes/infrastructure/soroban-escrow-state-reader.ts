import { simulateReadCall, u64ToScVal, type SorobanClient } from '../../../blockchain/index.js';
import type { DisputeEscrowStateReader, EscrowStatusForDispute } from '../domain/index.js';

const ESCROW_STATUS_FROM_RUST: Record<string, EscrowStatusForDispute> = {
  Locked: 'LOCKED',
  Released: 'RELEASED',
  Refunded: 'REFUNDED',
  Paused: 'PAUSED',
};

function unwrapUnitEnum(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') {
    throw new Error('Expected a one-element Vec of a Symbol (unit enum encoding)');
  }
  return value[0];
}

/**
 * Reads `escrow_contract.get_escrow` directly — a second, separate deployed
 * contract from `dispute_resolution_contract` — purely to disambiguate
 * `escrow.dispute_resolved` (see `sync-dispute-from-event.ts`'s header
 * comment). Only `status` is ever decoded; every other field on
 * `get_escrow`'s return is `escrow`'s own concern
 * (`escrow/infrastructure/escrow-scval-mapping.ts` already owns the full
 * decode for that module), not duplicated here.
 */
export function createSorobanEscrowStateReader(
  client: SorobanClient,
  escrowContractId: string,
): DisputeEscrowStateReader {
  return {
    async getEscrowStatus(chainDeliveryId): Promise<EscrowStatusForDispute> {
      const native = await simulateReadCall(client, {
        contractId: escrowContractId,
        method: 'get_escrow',
        args: [u64ToScVal(chainDeliveryId)],
      });
      if (typeof native !== 'object' || native === null) {
        throw new Error('Expected escrow_contract.get_escrow to return an object');
      }
      const variant = unwrapUnitEnum((native as Record<string, unknown>).status);
      const mapped = ESCROW_STATUS_FROM_RUST[variant];
      if (!mapped) {
        throw new Error(`Unknown EscrowState variant: ${variant}`);
      }
      return mapped;
    },
  };
}
