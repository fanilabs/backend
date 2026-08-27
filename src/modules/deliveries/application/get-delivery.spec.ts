import { describe, expect, it } from 'vitest';
import { createGetDeliveryUseCase } from './get-delivery.js';
import { DeliveryNotFoundError } from '../domain/index.js';
import { buildDelivery, createInMemoryDeliveryRepository } from './__fixtures__/fakes.js';

describe('getDelivery', () => {
  it('returns the delivery by chain id', async () => {
    const deliveryRepository = createInMemoryDeliveryRepository();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 42n }));

    const getDelivery = createGetDeliveryUseCase({ deliveryRepository });
    const result = await getDelivery({ chainDeliveryId: 42n });

    expect(result.chainDeliveryId).toBe(42n);
  });

  it('rejects an unknown chain id', async () => {
    const deliveryRepository = createInMemoryDeliveryRepository();
    const getDelivery = createGetDeliveryUseCase({ deliveryRepository });

    await expect(getDelivery({ chainDeliveryId: 999n })).rejects.toThrow(DeliveryNotFoundError);
  });
});
