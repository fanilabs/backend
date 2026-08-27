import type { Delivery, DeliveryFilter, DeliveryRepository } from '../domain/index.js';

export interface ListDeliveriesDeps {
  deliveryRepository: DeliveryRepository;
}

export function createListDeliveriesUseCase(deps: ListDeliveriesDeps) {
  return async function listDeliveries(filter: DeliveryFilter): Promise<Delivery[]> {
    return deps.deliveryRepository.list(filter);
  };
}
