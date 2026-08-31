import { describe, expect, it } from 'vitest';
import { createSyncDeliveryFromEventUseCase } from './sync-delivery-from-event.js';
import {
  buildChainDeliveryRecord,
  buildDelivery,
  buildDeliveryEvent,
  createFakeDeliveryContractReader,
  createInMemoryDeliveryRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const deliveryRepository = createInMemoryDeliveryRepository();
  const contractReader = createFakeDeliveryContractReader();
  const syncDeliveryFromEvent = createSyncDeliveryFromEventUseCase({
    deliveryRepository,
    contractReader,
  });
  return { deliveryRepository, contractReader, syncDeliveryFromEvent };
}

describe('syncDeliveryFromEvent', () => {
  it('ignores events from a different contract', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();

    await syncDeliveryFromEvent(buildDeliveryEvent({ contractName: 'escrow' }));

    expect(await deliveryRepository.list({})).toHaveLength(0);
  });

  it('delivery_created: hydrates the full record via get_delivery and creates it locally', async () => {
    const { deliveryRepository, contractReader, syncDeliveryFromEvent } = setup();
    contractReader.seed(7n, buildChainDeliveryRecord({ chainDeliveryId: 7n, origin: 'Nairobi' }));

    await syncDeliveryFromEvent(
      buildDeliveryEvent({ topic: ['delivery_created'], payload: ['7', 'GSENDER'] }),
    );

    const stored = await deliveryRepository.findByChainId(7n);
    expect(stored?.origin).toBe('Nairobi');
    expect(stored?.status).toBe('PENDING');
  });

  it('driver_assigned: sets driver and status ACTIVE', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, status: 'PENDING' }));

    await syncDeliveryFromEvent(
      buildDeliveryEvent({ topic: ['driver_assigned'], payload: ['1', 'GDRIVER'] }),
    );

    const stored = await deliveryRepository.findByChainId(1n);
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.driverAddress).toBe('GDRIVER');
  });

  it('DeliveryInTransit: sets status IN_TRANSIT and transitStartedAt from the ledger close time', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, status: 'ACTIVE' }));
    const closedAt = new Date('2026-01-01T00:00:00Z');

    await syncDeliveryFromEvent(
      buildDeliveryEvent({
        topic: ['DeliveryInTransit'],
        payload: ['1', 'GDRIVER', '1700000000'],
        closedAt,
      }),
    );

    const stored = await deliveryRepository.findByChainId(1n);
    expect(stored?.status).toBe('IN_TRANSIT');
    expect(stored?.transitStartedAt).toEqual(closedAt);
  });

  it('delivery_confirmed: sets status DELIVERED and deliveredAt from the ledger close time', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, status: 'IN_TRANSIT' }));
    const closedAt = new Date('2026-01-02T00:00:00Z');

    await syncDeliveryFromEvent(
      buildDeliveryEvent({ topic: ['delivery_confirmed'], payload: ['1', 'GRECIPIENT'], closedAt }),
    );

    const stored = await deliveryRepository.findByChainId(1n);
    expect(stored?.status).toBe('DELIVERED');
    expect(stored?.deliveredAt).toEqual(closedAt);
  });

  it('delivery_cancelled: sets status CANCELLED', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, status: 'PENDING' }));

    await syncDeliveryFromEvent(
      buildDeliveryEvent({ topic: ['delivery_cancelled'], payload: ['1', 'GSENDER'] }),
    );

    expect((await deliveryRepository.findByChainId(1n))?.status).toBe('CANCELLED');
  });

  it('delivery_disputed: sets status DISPUTED', async () => {
    const { deliveryRepository, syncDeliveryFromEvent } = setup();
    deliveryRepository.seed(buildDelivery({ chainDeliveryId: 1n, status: 'ACTIVE' }));

    await syncDeliveryFromEvent(
      buildDeliveryEvent({ topic: ['delivery_disputed'], payload: ['1', 'GSENDER', '1700000000'] }),
    );

    expect((await deliveryRepository.findByChainId(1n))?.status).toBe('DISPUTED');
  });

  it('ignores an unrecognized event topic without throwing', async () => {
    const { syncDeliveryFromEvent } = setup();

    await expect(
      syncDeliveryFromEvent(buildDeliveryEvent({ topic: ['some_future_event'] })),
    ).resolves.toBeUndefined();
  });

  it('ignores a malformed payload without throwing', async () => {
    const { syncDeliveryFromEvent } = setup();

    await expect(
      syncDeliveryFromEvent(
        buildDeliveryEvent({ topic: ['driver_assigned'], payload: 'not-an-array' }),
      ),
    ).resolves.toBeUndefined();
  });
});
