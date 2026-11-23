import { describe, expect, it, vi } from 'vitest';
import { GetFleet } from './get-fleet.js';
import type { FleetRepository } from '../domain/fleet-repository.js';

function createSpyRepository() {
  const findById = vi.fn().mockResolvedValue(null);
  const repository = { findById } as unknown as FleetRepository;
  return { repository, findById };
}

describe('GetFleet', () => {
  it('forwards an explicitly supplied includeRemoved=false without dropping it', async () => {
    const { repository, findById } = createSpyRepository();
    const useCase = new GetFleet(repository);

    await useCase.execute({ chainFleetId: '123', includeRemoved: false, driverLimit: 100 });

    expect(findById).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledWith(
      expect.objectContaining({ includeRemoved: false }),
    );
  });

  it('forwards an explicitly supplied driverLimit without dropping it', async () => {
    const { repository, findById } = createSpyRepository();
    const useCase = new GetFleet(repository);

    await useCase.execute({ chainFleetId: '123', includeRemoved: true, driverLimit: 250 });

    expect(findById).toHaveBeenCalledWith(
      expect.objectContaining({ driverLimit: 250 }),
    );
  });

  it('forwards both false and driverLimit together', async () => {
    const { repository, findById } = createSpyRepository();
    const useCase = new GetFleet(repository);

    await useCase.execute({ chainFleetId: '123', includeRemoved: false, driverLimit: 500 });

    expect(findById).toHaveBeenCalledWith(
      expect.objectContaining({ includeRemoved: false, driverLimit: 500 }),
    );
  });
});
