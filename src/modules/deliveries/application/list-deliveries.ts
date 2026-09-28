import type { Delivery, DeliveryFilter, DeliveryRepository } from '../domain/index.js';

export interface ListDeliveriesDeps {
  deliveryRepository: DeliveryRepository;
}

/** Creates a use case that lists deliveries matching the supplied filters. */
export function createListDeliveriesUseCase(deps: ListDeliveriesDeps) {
  return async function listDeliveries(filter: DeliveryFilter): Promise<Delivery[]> {
    return deps.deliveryRepository.list(filter);
  };
}
