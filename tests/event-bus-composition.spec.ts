import { afterEach, describe, expect, it } from 'vitest';
import * as events from '../src/shared/events/index.js';
import { createInProcessEventBus } from '../src/modules/indexer/infrastructure/in-process-event-bus.js';
import { createRecordActorActivityFromEventUseCase } from '../src/modules/fraud-detection/application/record-actor-activity-from-event.js';
import { subscribeFraudDetectionEventDispatch } from '../src/modules/fraud-detection/infrastructure/event-subscription.js';
import { subscribeDeliveryEventSync } from '../src/modules/deliveries/infrastructure/event-subscription.js';
import { createInMemoryActorActivityRepository } from '../src/modules/fraud-detection/application/__fixtures__/fakes.js';
import type { ActorActivityRepository } from '../src/modules/fraud-detection/domain/index.js';
import { eventSubscriberErrorsTotal } from '../src/shared/metrics/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

function buildEvent(): events.BlockchainEventEnvelope {
  return {
    contractName: 'delivery',
    network: 'testnet',
    rpcEventId: 'composition-event',
    ledgerSeq: 42n,
    txHash: 'composition-transaction',
    topic: ['delivery_created'],
    payload: ['7', testAddress('sender')],
    closedAt: new Date('2026-01-01T12:00:00Z'),
  };
}

function createGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('real in-process event-bus composition', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  it('exports the runtime blockchain contract alongside the actor-alert factory', async () => {
    const loaded = await import('../src/shared/events/index.js');
    for (const name of [
      'publishBlockchainEvent',
      'onBlockchainEvent',
      'subscribeBlockchainEventHandler',
      'parseAddress',
      'parseBigIntId',
      'createActorFlaggedEvent',
    ] as const) {
      expect(loaded[name]).toBeTypeOf('function');
    }
    expect(loaded.EVENT_DISPATCH_CONCURRENCY).toBe(10);
    expect(loaded.ContractName.Delivery).toBe('delivery');
    expect(loaded.parseAddress(testAddress('sender'))).toBe(testAddress('sender'));
    expect(loaded.parseBigIntId('7')).toBe(7n);
    const payload: events.ActorFlaggedPayload = {
      address: testAddress('sender'),
      signals: ['rule'],
    };
    const alert: events.ActorFlaggedEvent = loaded.createActorFlaggedEvent(payload);
    expect(alert).toEqual({ type: 'actor_flagged', payload, occurredAt: expect.any(Date) });
  });

  it('delivers the original envelope through the indexer adapter and real fraud subscription', async () => {
    const repository = createInMemoryActorActivityRepository();
    const record = createRecordActorActivityFromEventUseCase({ activityRepository: repository });
    const off = subscribeFraudDetectionEventDispatch(record);
    cleanup.push(off);
    const received: events.BlockchainEventEnvelope[] = [];
    cleanup.push(
      events.onBlockchainEvent((event) => {
        received.push(event);
      }),
    );
    const bus = createInProcessEventBus();
    const event = buildEvent();

    await bus.publish(event);

    expect(received).toEqual([event]);
    expect(received[0]).toBe(event);
    expect(repository.all()).toEqual([
      { address: testAddress('sender'), category: 'DELIVERY_CREATED', occurredAt: event.closedAt },
    ]);
    off();
    await bus.publish({ ...event, rpcEventId: 'after-unsubscribe' });
    expect(repository.all()).toHaveLength(1);
  });

  it('awaits completion of the real fraud handler before publication resolves', async () => {
    const repository = createInMemoryActorActivityRepository();
    const entered = createGate();
    const finish = createGate();
    const activityRepository: ActorActivityRepository = {
      ...repository,
      async record(input) {
        entered.release();
        await finish.promise;
        await repository.record(input);
      },
    };
    cleanup.push(
      subscribeFraudDetectionEventDispatch(
        createRecordActorActivityFromEventUseCase({ activityRepository }),
      ),
    );
    let settled = false;
    const published = Promise.resolve(createInProcessEventBus().publish(buildEvent())).then(() => {
      settled = true;
    });
    try {
      await entered.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(repository.all()).toEqual([]);
    } finally {
      finish.release();
      await published;
    }
    expect(settled).toBe(true);
    expect(repository.all()).toHaveLength(1);
  });

  it('counts a real subscriber rejection once, resolves publication, and continues delivery', async () => {
    const repository = createInMemoryActorActivityRepository();
    let fail = true;
    const activityRepository: ActorActivityRepository = {
      ...repository,
      async record(input) {
        if (fail) throw new Error('isolated repository failure');
        await repository.record(input);
      },
    };
    cleanup.push(
      subscribeFraudDetectionEventDispatch(
        createRecordActorActivityFromEventUseCase({ activityRepository }),
      ),
    );
    const labels = {
      contract: 'delivery',
      event: 'delivery_created',
      subscriber: 'Failed to record actor activity from blockchain event',
    };
    const failureCount = async () => {
      const metric = await eventSubscriberErrorsTotal.get();
      return (
        metric.values.find(
          (value) =>
            value.labels.contract === labels.contract &&
            value.labels.event === labels.event &&
            value.labels.subscriber === labels.subscriber,
        )?.value ?? 0
      );
    };
    const before = await failureCount();
    const bus = createInProcessEventBus();
    await expect(bus.publish(buildEvent())).resolves.toBeUndefined();
    expect(await failureCount()).toBe(before + 1);
    expect(repository.all()).toEqual([]);
    fail = false;
    await bus.publish({ ...buildEvent(), rpcEventId: 'following-event' });
    expect(repository.all()).toHaveLength(1);
    expect(await failureCount()).toBe(before + 1);
  });

  it('retains the delivery subscription wrapper’s existing fire-and-forget behavior', async () => {
    const entered = createGate();
    const finish = createGate();
    let completed = false;
    cleanup.push(
      subscribeDeliveryEventSync(async () => {
        entered.release();
        await finish.promise;
        completed = true;
      }),
    );
    try {
      await createInProcessEventBus().publish(buildEvent());
      await entered.promise;
      expect(completed).toBe(false);
    } finally {
      finish.release();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(completed).toBe(true);
  });
});
