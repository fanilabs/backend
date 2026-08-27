import type { Delivery, DeliveryRepository } from '../domain/index.js';
import { DeliveryNotFoundError } from '../domain/index.js';

export interface GetDeliveryDeps {
  deliveryRepository: DeliveryRepository;
}

export interface GetDeliveryInput {
  chainDeliveryId: bigint;
}

export function createGetDeliveryUseCase(deps: GetDeliveryDeps) {
  return async function getDelivery(input: GetDeliveryInput): Promise<Delivery> {
    const delivery = await deps.deliveryRepository.findByChainId(input.chainDeliveryId);
    if (!delivery) {
      throw new DeliveryNotFoundError();
    }
    return delivery;
  };
}
