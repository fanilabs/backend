import type { Delivery, DeliveryRepository } from '../domain/index.js';
import { DeliveryNotFoundError } from '../domain/index.js';

export interface GetDeliveryDeps {
  deliveryRepository: DeliveryRepository;
}

export interface GetDeliveryInput {
  chainDeliveryId: bigint;
}

/**
 * Creates the use case for retrieving a single delivery by its on-chain identifier.
 *
 * @param deps - The dependencies required by the use case.
 * @param deps.deliveryRepository - Repository used to look up deliveries by chain id.
 * @returns An async function that takes a {@link GetDeliveryInput} and resolves with the
 * matching {@link Delivery}. Throws {@link DeliveryNotFoundError} when no delivery exists
 * for the provided `chainDeliveryId`.
 */
export function createGetDeliveryUseCase(deps: GetDeliveryDeps) {
  return async function getDelivery(input: GetDeliveryInput): Promise<Delivery> {
    const delivery = await deps.deliveryRepository.findByChainId(input.chainDeliveryId);
    if (!delivery) {
      throw new DeliveryNotFoundError();
    }
    return delivery;
  };
}
