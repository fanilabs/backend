import { describe, expect, it } from 'vitest';
import { createGetFleetUseCase } from './get-fleet.js';
import { FleetNotFoundError } from '../domain/index.js';
import {
  buildFleetDriver,
  buildFleetWithDrivers,
  createInMemoryFleetRepository,
} from './__fixtures__/fakes.js';

describe('getFleet', () => {
  it('returns the fleet with its drivers and a computed totalActiveDrivers', async () => {
    const fleetRepository = createInMemoryFleetRepository();
    fleetRepository.seed(
      buildFleetWithDrivers({
        chainFleetId: 42n,
        drivers: [
          buildFleetDriver({ driverAddress: 'GACTIVE', status: 'ACTIVE' }),
          buildFleetDriver({ driverAddress: 'GPENDING', status: 'PENDING' }),
          buildFleetDriver({ driverAddress: 'GREMOVED', status: 'ACTIVE', removedAt: new Date() }),
        ],
      }),
    );

    const getFleet = createGetFleetUseCase({ fleetRepository });
    const result = await getFleet({ chainFleetId: 42n });

    expect(result.chainFleetId).toBe(42n);
    expect(result.drivers).toHaveLength(3);
    expect(result.totalActiveDrivers).toBe(1);
  });

  it('rejects an unknown chain fleet id', async () => {
    const fleetRepository = createInMemoryFleetRepository();
    const getFleet = createGetFleetUseCase({ fleetRepository });

    await expect(getFleet({ chainFleetId: 999n })).rejects.toThrow(FleetNotFoundError);
  });
});
