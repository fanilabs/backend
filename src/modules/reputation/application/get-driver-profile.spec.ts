import { describe, expect, it } from 'vitest';
import { createGetDriverProfileUseCase } from './get-driver-profile.js';
import { buildDriverProfile, createInMemoryDriverProfileRepository } from './__fixtures__/fakes.js';
import { DriverProfileNotFoundError } from '../domain/index.js';

describe('getDriverProfile', () => {
  it('throws DriverProfileNotFoundError for an unregistered address', async () => {
    const driverProfileRepository = createInMemoryDriverProfileRepository();
    const getDriverProfile = createGetDriverProfileUseCase({ driverProfileRepository });

    await expect(getDriverProfile({ address: 'GUNKNOWN' })).rejects.toBeInstanceOf(
      DriverProfileNotFoundError,
    );
  });

  it('returns the stored profile', async () => {
    const driverProfileRepository = createInMemoryDriverProfileRepository();
    driverProfileRepository.seed(buildDriverProfile({ address: 'GDRIVER', tier: 'GOLD' }));
    const getDriverProfile = createGetDriverProfileUseCase({ driverProfileRepository });

    const profile = await getDriverProfile({ address: 'GDRIVER' });

    expect(profile.tier).toBe('GOLD');
  });
});
