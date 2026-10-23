import { describe, expect, it } from 'vitest';
import { testAddress } from '../../../shared/testing/addresses.js';
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
        payload: ['1', testAddress('sender')],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: testAddress('sender'),
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
        payload: [testAddress('driver'), '1000', '25'],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: testAddress('driver'),
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
        payload: [testAddress('disputer')],
      }),
    );

    expect(activityRepository.all()).toEqual([
      {
        address: testAddress('disputer'),
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
        payload: ['1', testAddress('driver')],
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
        payload: ['1', testAddress('a'), testAddress('b')],
      }),
    );

    expect(activityRepository.all()).toHaveLength(0);
  });
});

describe('recordActorActivityFromEvent actor_flagged notification (#408)', () => {
  it('emits notifyActorFlagged only on unflagged -> flagged transition', async () => {
    const repo = createInMemoryActorActivityRepository();
    const notified: string[] = [];
    let count = 0;
    const useCase = createRecordActorActivityFromEventUseCase({
      activityRepository: repo,
      assessActor: async ({ address }) => {
        count += 1;
        return { address, flagged: count >= 2, signals: [] };
      },
      alertNotifier: {
        notifyActorFlagged: async (a) => {
          notified.push(a.address);
        },
      },
    });

    const targetAddr = testAddress('flagged-actor');
    await useCase(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['delivery_disputed'],
        payload: [targetAddr],
      }),
    );
    expect(notified).toEqual([targetAddr]);
  });
});
