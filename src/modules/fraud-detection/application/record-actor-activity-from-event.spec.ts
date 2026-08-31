import { describe, expect, it } from 'vitest';
import { createRecordActorActivityFromEventUseCase } from './record-actor-activity-from-event.js';
import {
  buildBlockchainEvent,
  createInMemoryActorActivityRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const activityRepository = createInMemoryActorActivityRepository();
  const recordActorActivityFromEvent = createRecordActorActivityFromEventUseCase({
    activityRepository,
  });
  return { activityRepository, recordActorActivityFromEvent };
}

describe('recordActorActivityFromEvent', () => {
  it('delivery_created: logs DELIVERY_CREATED against the sender (payload[1])', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['delivery_created'],
        payload: ['1', 'GSENDER'],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: 'GSENDER',
        category: 'DELIVERY_CREATED',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('escrow_released: logs ESCROW_RELEASED against the driver (payload[0])', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['escrow_released', '5'],
        payload: ['GDRIVER', '1000', '25'],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: 'GDRIVER',
        category: 'ESCROW_RELEASED',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('delivery_disputed: logs DISPUTE_RAISED against the disputing party (payload[0])', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['delivery_disputed', '5'],
        payload: ['GDISPUTER'],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: 'GDISPUTER',
        category: 'DISPUTE_RAISED',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
  });

  it('ignores other escrow events (e.g. escrow_funded)', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({ contractName: 'escrow', topic: ['escrow_funded', '5'], payload: [] }),
    );

    expect(activityRepository.all()).toHaveLength(0);
  });

  it('ignores other delivery events (e.g. driver_assigned)', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['driver_assigned'],
        payload: ['1', 'GDRIVER'],
      }),
    );

    expect(activityRepository.all()).toHaveLength(0);
  });

  it('ignores contracts with no fraud-detection handler at all', async () => {
    const { activityRepository, recordActorActivityFromEvent } = setup();

    await recordActorActivityFromEvent(
      buildBlockchainEvent({
        contractName: 'fleet',
        topic: ['fleet_registered'],
        payload: ['1', 'GA', 'GB'],
      }),
    );

    expect(activityRepository.all()).toHaveLength(0);
  });
});
