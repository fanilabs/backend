import type { FleetRepository, PaginationOptions } from '../domain/ports.js';
import type { Fleet } from '../domain/entities.js';

export interface ListMyFleetsInput {
  ownerAddresses: string[];
  options?: PaginationOptions;
}

export interface ListMyFleetsResult {
  fleets: Fleet[];
  total: number;
  page: number;
  pageSize: number;
}

export type ListMyFleetsUseCase = (input: ListMyFleetsInput) => Promise<ListMyFleetsResult>;

export function createListMyFleetsUseCase(fleetRepository: FleetRepository): ListMyFleetsUseCase {
  return async ({ ownerAddresses, options }) => {
    const uniqueOwners = Array.from(
      new Set(
        ownerAddresses.map((address) => address.trim()).filter((address) => address.length > 0),
      ),
    );

    if (uniqueOwners.length === 0) {
      return {
        fleets: [],
        total: 0,
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? 20,
      };
    }

    const fleets = await fleetRepository.listFleetsByOwner(uniqueOwners, options);

    return {
      fleets,
      total: fleets.length,
      page: options?.page ?? 1,
      pageSize: options?.pageSize ?? 20,
    };
  };
}
