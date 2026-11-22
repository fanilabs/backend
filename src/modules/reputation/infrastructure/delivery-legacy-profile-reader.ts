import type { LegacyDriverProfileReader } from '../domain/index.js';
import { addressToScVal, simulateReadCall } from '../../../shared/stellar/index.js';
import type { SorobanClient } from '../../../shared/stellar/index.js';

const deliveryContractId = process.env.DELIVERY_CONTRACT_ID;

export function createDeliveryLegacyProfileReader(client: SorobanClient): LegacyDriverProfileReader {
  return {
    async getLegacyDeliveriesCompleted(address: string): Promise<number> {
      if (!deliveryContractId) {
        throw new Error('DELIVERY_CONTRACT_ID is not configured');
      }

      const native = await simulateReadCall(client, {
        contractId: deliveryContractId,
        method: 'get_driver_profile',
        args: [addressToScVal(address)],
      });

      // `get_driver_profile` returns `None` (null) for drivers that have no
      // profile in `delivery_contract` — a normal condition for newly
      // registered drivers or those that only used newer contracts. Treat it
      // as zero completed legacy deliveries rather than throwing.
      if (native === null) {
        return 0;
      }

      if (typeof native !== 'object') {
        throw new Error('Expected delivery_contract.get_driver_profile to return an object');
      }

      const deliveriesCompleted = (native as { deliveries_completed?: unknown }).deliveries_completed;
      if (typeof deliveriesCompleted !== 'number') {
        throw new Error('Expected delivery_contract.get_driver_profile.deliveries_completed to be a number');
      }

      return deliveriesCompleted;
    },
  };
}
