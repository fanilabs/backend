import type { FleetRepository, FleetWithDrivers } from '../domain/index.js';
import { FleetNotFoundError } from '../domain/index.js';

export interface GetFleetDeps {
  fleetRepository: FleetRepository;
}

export interface GetFleetInput {
  chainFleetId: bigint;
  includeRemoved?: boolean;
  driverLimit?: number;
}

export function createGetFleetUseCase(deps: GetFleetDeps) {
  return async function getFleet(input: GetFleetInput): Promise<FleetWithDrivers> {
    const fleet = await deps.fleetRepository.findByChainFleetId(input.chainFleetId, {
      includeRemoved: input.includeRemoved,
      driverLimit: input.driverLimit,
    });
    if (!fleet) {
      throw new FleetNotFoundError();
    }
    return fleet;
  };
}
