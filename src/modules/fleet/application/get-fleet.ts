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

/**
 * Creates a use case that retrieves a fleet with its drivers and throws
 * `FleetNotFoundError` when no fleet exists for the requested chain ID.
 */
export function createGetFleetUseCase(deps: GetFleetDeps) {
  return async function getFleet(input: GetFleetInput): Promise<FleetWithDrivers> {
    const fleet = await deps.fleetRepository.findByChainFleetId(input.chainFleetId, {
      ...(input.includeRemoved !== undefined && { includeRemoved: input.includeRemoved }),
      ...(input.driverLimit !== undefined && { driverLimit: input.driverLimit }),
    });
    if (!fleet) {
      throw new FleetNotFoundError();
    }
    return fleet;
  };
}
