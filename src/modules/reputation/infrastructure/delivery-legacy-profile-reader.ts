import { addressToScVal, simulateReadCall, type SorobanClient } from '../../../blockchain/index.js';
import type { LegacyDriverProfileReader } from '../domain/index.js';

/**
 * Reads `delivery_contract`'s own, separate `get_driver_profile` — the
 * "legacy" reputation ledger (PHASE_1_DOMAIN_ANALYSIS.md §4/§12). Targets
 * `DELIVERY_CONTRACT_ID`, not `IDENTITY_REPUTATION_CONTRACT_ID` — a
 * genuinely different deployed contract from
 * `soroban-reputation-contract-client.ts`. Only `deliveries_completed` is
 * ever read from it; every other field on that contract's `DriverProfile`
 * (its own, redundant `reputation_score`) is intentionally never surfaced,
 * per the Phase 1 §12 decision to treat `identity_reputation_contract` as
 * the sole canonical score.
 */
export function createDeliveryLegacyProfileReader(
  client: SorobanClient,
  deliveryContractId: string,
): LegacyDriverProfileReader {
  return {
    async getLegacyDeliveriesCompleted(address) {
      const native = await simulateReadCall(client, {
        contractId: deliveryContractId,
        method: 'get_driver_profile',
        args: [addressToScVal(address)],
      });
      if (typeof native !== 'object' || native === null) {
        throw new Error('Expected delivery_contract.get_driver_profile to return an object');
      }
      const deliveriesCompleted = (native as Record<string, unknown>).deliveries_completed;
      if (typeof deliveriesCompleted !== 'number') {
        throw new Error('Expected "deliveries_completed" to be a number');
      }
      return deliveriesCompleted;
    },
  };
}
