import type { DriverProfile, DriverProfileRepository } from '../domain/index.js';
import { DriverProfileNotFoundError } from '../domain/index.js';

export interface GetDriverProfileDeps {
  driverProfileRepository: DriverProfileRepository;
}

export interface GetDriverProfileInput {
  address: string;
}

/**
 * Creates the use case for retrieving a driver's reputation profile.
 *
 * @param deps - Use case dependencies; requires a `driverProfileRepository`
 *   used to find the profile by Stellar address.
 * @returns An async function that resolves to the driver's profile or throws
 *   when no profile exists for the requested address.
 */
export function createGetDriverProfileUseCase(deps: GetDriverProfileDeps) {
  return async function getDriverProfile(input: GetDriverProfileInput): Promise<DriverProfile> {
    const profile = await deps.driverProfileRepository.findByAddress(input.address);
    if (!profile) {
      throw new DriverProfileNotFoundError();
    }
    return profile;
  };
}
