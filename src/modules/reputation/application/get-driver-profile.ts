import type { DriverProfile, DriverProfileRepository } from '../domain/index.js';
import { DriverProfileNotFoundError } from '../domain/index.js';

export interface GetDriverProfileDeps {
  driverProfileRepository: DriverProfileRepository;
}

export interface GetDriverProfileInput {
  address: string;
}

export function createGetDriverProfileUseCase(deps: GetDriverProfileDeps) {
  return async function getDriverProfile(input: GetDriverProfileInput): Promise<DriverProfile> {
    const profile = await deps.driverProfileRepository.findByAddress(input.address);
    if (!profile) {
      throw new DriverProfileNotFoundError();
    }
    return profile;
  };
}
