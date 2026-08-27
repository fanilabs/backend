import { describe, expect, it } from 'vitest';
import { createListDeliveriesUseCase } from './list-deliveries.js';
import { buildDelivery, createInMemoryDeliveryRepository } from './__fixtures__/fakes.js';

describe('listDeliveries', () => {
  it('filters by sender address', async () => {
    const deliveryRepository = createInMemoryDeliveryRepository();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, senderAddress: 'GA' }));
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 2n, senderAddress: 'GB' }));

    const listDeliveries = createListDeliveriesUseCase({ deliveryRepository });
    const result = await listDeliveries({ senderAddress: 'GA' });

    expect(result).toHaveLength(1);
    expect(result[0]?.chainDeliveryId).toBe(1n);
  });
});
