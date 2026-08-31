import { describe, expect, it } from 'vitest';
import { createDispatchNotificationsFromEventUseCase } from './dispatch-notifications-from-event.js';
import {
  buildBlockchainEvent,
  createFakeNotificationJobScheduler,
  createFakeUserContactLookup,
  createInMemoryNotificationRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const notificationRepository = createInMemoryNotificationRepository();
  const userContactLookup = createFakeUserContactLookup();
  const jobScheduler = createFakeNotificationJobScheduler();
  const dispatchNotificationsFromEvent = createDispatchNotificationsFromEventUseCase({
    notificationRepository,
    userContactLookup,
    jobScheduler,
  });
  return {
    notificationRepository,
    userContactLookup,
    jobScheduler,
    dispatchNotificationsFromEvent,
  };
}

describe('dispatchNotificationsFromEvent', () => {
  it('delivery.driver_assigned: notifies the assigned driver', async () => {
    const {
      notificationRepository,
      userContactLookup,
      jobScheduler,
      dispatchNotificationsFromEvent,
    } = setup();
    userContactLookup.seedAddress('GDRIVER', { userId: 'user-1', email: 'driver@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['driver_assigned'],
        payload: ['1', 'GDRIVER'],
      }),
    );

    const [notification] = notificationRepository.all();
    expect(notification).toMatchObject({
      userId: 'user-1',
      channel: 'EMAIL',
      type: 'delivery.driver_assigned',
      status: 'PENDING',
      payload: { chainDeliveryId: '1' },
    });
    expect(jobScheduler.enqueued).toEqual([notification?.id]);
  });

  it('escrow.delivery_disputed: notifies the disputing party, reading the id from the topic', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GSENDER', { userId: 'user-2', email: 'sender@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['delivery_disputed', '7'],
        payload: ['GSENDER'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-2', type: 'escrow.delivery_disputed', payload: { chainDeliveryId: '7' } },
    ]);
  });

  it('escrow.escrow_released: notifies the driver, reading the id from the topic and the address from payload[0]', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GDRIVER', {
      userId: 'user-driver',
      email: 'driver@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['escrow_released', '9'],
        payload: ['GDRIVER', '1000', '25'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-driver', type: 'escrow.escrow_released', payload: { chainDeliveryId: '9' } },
    ]);
  });

  it('dispute.dispute_raised: notifies the raiser, parsing the tuple-wrapped delivery id', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GRAISER', { userId: 'user-3', email: 'raiser@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'dispute-resolution',
        topic: ['dispute_raised', '["3"]'],
        payload: ['GRAISER'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-3', type: 'dispute.dispute_raised', payload: { chainDeliveryId: '3' } },
    ]);
  });

  it.each([
    'driver_registered',
    'kyc_status_updated',
    'reputation_increased',
    'reputation_decreased',
  ])('identity-reputation %s: notifies the driver', async (eventName) => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GDRIVER', { userId: 'user-4', email: 'driver@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'identity-reputation',
        topic: [eventName],
        payload: ['GDRIVER', '10'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-4', type: `reputation.${eventName}` },
    ]);
  });

  it('fleet.fleet_registered: notifies the fleet owner', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GOWNER', { userId: 'user-5', email: 'owner@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'fleet',
        topic: ['fleet_registered'],
        payload: ['1', 'GOWNER', 'GTREASURY'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-5', type: 'fleet.fleet_registered', payload: { chainFleetId: '1' } },
    ]);
  });

  it.each(['driver_invited', 'invite_accepted', 'driver_removed'])(
    'fleet.%s: notifies the driver',
    async (eventName) => {
      const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
      userContactLookup.seedAddress('GDRIVER', { userId: 'user-6', email: 'driver@example.com' });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'fleet',
          topic: [eventName],
          payload: ['1', 'GDRIVER'],
        }),
      );

      expect(notificationRepository.all()).toMatchObject([
        { userId: 'user-6', type: `fleet.${eventName}` },
      ]);
    },
  );

  it('skips delivery_created even though its payload does carry an address (sender) — self-action, not a useful notification', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress('GSENDER', { userId: 'user-7', email: 'sender@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['delivery_created'],
        payload: ['1', 'GSENDER'],
      }),
    );

    expect(notificationRepository.all()).toHaveLength(0);
  });

  it('skips events with genuinely no address at all in topic or payload (e.g. delivery_confirmed)', async () => {
    const { notificationRepository, dispatchNotificationsFromEvent } = setup();

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['delivery_confirmed'],
        payload: ['1'],
      }),
    );

    expect(notificationRepository.all()).toHaveLength(0);
  });

  it('skips an event whose actor address has no linked local account', async () => {
    const { notificationRepository, jobScheduler, dispatchNotificationsFromEvent } = setup();

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['driver_assigned'],
        payload: ['1', 'GUNLINKED'],
      }),
    );

    expect(notificationRepository.all()).toHaveLength(0);
    expect(jobScheduler.enqueued).toHaveLength(0);
  });

  it('ignores contracts with no notification handler at all', async () => {
    const { notificationRepository, dispatchNotificationsFromEvent } = setup();

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({ contractName: 'unknown-contract', topic: ['whatever'], payload: [] }),
    );

    expect(notificationRepository.all()).toHaveLength(0);
  });
});
