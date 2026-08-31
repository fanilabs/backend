import { describe, expect, it } from 'vitest';
import { createSyncFleetFromEventUseCase } from './sync-fleet-from-event.js';
import {
  buildFleetEvent,
  buildFleetWithDrivers,
  createInMemoryFleetRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const fleetRepository = createInMemoryFleetRepository();
  const syncFleetFromEvent = createSyncFleetFromEventUseCase({ fleetRepository });
  return { fleetRepository, syncFleetFromEvent };
}

describe('syncFleetFromEvent', () => {
  it('ignores events from a different contract', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();

    await syncFleetFromEvent(buildFleetEvent({ contractName: 'escrow' }));

    expect(await fleetRepository.findByChainFleetId(1n)).toBeNull();
  });

  it('reads fleet_id from payload[0] — fleet_management_contract uses single-segment topics, not the topic itself', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();

    await syncFleetFromEvent(
      buildFleetEvent({
        topic: ['fleet_registered'],
        payload: ['7', 'GOWNER', 'GTREASURY'],
      }),
    );

    const stored = await fleetRepository.findByChainFleetId(7n);
    expect(stored?.ownerAddress).toBe('GOWNER');
    expect(stored?.treasuryAddress).toBe('GTREASURY');
  });

  it('fleet_treasury_updated: updates the treasury address', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();
    fleetRepository.seed(buildFleetWithDrivers({ chainFleetId: 1n, treasuryAddress: 'GOLD' }));

    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['fleet_treasury_updated'], payload: ['1', 'GOWNER', 'GNEW'] }),
    );

    expect((await fleetRepository.findByChainFleetId(1n))?.treasuryAddress).toBe('GNEW');
  });

  it('driver_invited: adds a PENDING driver row with invitedAt from ledger close time', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();
    fleetRepository.seed(buildFleetWithDrivers({ chainFleetId: 1n }));
    const closedAt = new Date('2026-01-01T00:00:00Z');

    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['driver_invited'], payload: ['1', 'GDRIVER'], closedAt }),
    );

    const stored = await fleetRepository.findByChainFleetId(1n);
    expect(stored?.drivers).toHaveLength(1);
    expect(stored?.drivers[0]).toMatchObject({
      driverAddress: 'GDRIVER',
      status: 'PENDING',
      invitedAt: closedAt,
    });
  });

  it('invite_accepted: promotes the driver to ACTIVE and sets acceptedAt', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();
    fleetRepository.seed(buildFleetWithDrivers({ chainFleetId: 1n }));
    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['driver_invited'], payload: ['1', 'GDRIVER'] }),
    );
    const closedAt = new Date('2026-01-02T00:00:00Z');

    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['invite_accepted'], payload: ['1', 'GDRIVER'], closedAt }),
    );

    const stored = await fleetRepository.findByChainFleetId(1n);
    expect(stored?.drivers[0]).toMatchObject({ status: 'ACTIVE', acceptedAt: closedAt });
    expect(stored?.totalActiveDrivers).toBe(1);
  });

  it('driver_removed: sets removedAt without deleting the row (soft delete for audit)', async () => {
    const { fleetRepository, syncFleetFromEvent } = setup();
    fleetRepository.seed(buildFleetWithDrivers({ chainFleetId: 1n }));
    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['driver_invited'], payload: ['1', 'GDRIVER'] }),
    );
    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['invite_accepted'], payload: ['1', 'GDRIVER'] }),
    );
    const closedAt = new Date('2026-01-03T00:00:00Z');

    await syncFleetFromEvent(
      buildFleetEvent({ topic: ['driver_removed'], payload: ['1', 'GDRIVER'], closedAt }),
    );

    const stored = await fleetRepository.findByChainFleetId(1n);
    expect(stored?.drivers).toHaveLength(1);
    expect(stored?.drivers[0]?.removedAt).toEqual(closedAt);
    expect(stored?.totalActiveDrivers).toBe(0);
  });

  it('ignores an event with a missing/malformed fleet id in the payload', async () => {
    const { syncFleetFromEvent } = setup();

    await expect(
      syncFleetFromEvent(buildFleetEvent({ topic: ['fleet_registered'], payload: [] })),
    ).resolves.toBeUndefined();
  });
});
