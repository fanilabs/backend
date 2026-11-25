import { describe, expect, it } from 'vitest';
import { testAddress } from '../../../shared/testing/addresses.js';
import { createDispatchNotificationsFromEventUseCase } from './dispatch-notifications-from-event.js';
import {
  buildBlockchainEvent,
  createFakeDeliveryPartyLookup,
  createFakeNotificationJobScheduler,
  createFakeNotificationPreferenceRepository,
  createFakeUserContactLookup,
  createInMemoryNotificationRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const notificationRepository = createInMemoryNotificationRepository();
  const userContactLookup = createFakeUserContactLookup();
  const deliveryPartyLookup = createFakeDeliveryPartyLookup();
  const jobScheduler = createFakeNotificationJobScheduler();
  const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
  const dispatchNotificationsFromEvent = createDispatchNotificationsFromEventUseCase({
    notificationRepository,
    userContactLookup,
    deliveryPartyLookup,
    jobScheduler,
    notificationPreferenceRepository,
  });
  return {
    notificationRepository,
    userContactLookup,
    deliveryPartyLookup,
    jobScheduler,
    notificationPreferenceRepository,
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
    userContactLookup.seedAddress(testAddress('driver'), {
      userId: 'user-1',
      email: 'driver@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['driver_assigned'],
        payload: ['1', testAddress('driver')],
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

  it('delivery.delivery_confirmed: notifies sender and driver resolved via deliveryPartyLookup', async () => {
    const {
      notificationRepository,
      userContactLookup,
      deliveryPartyLookup,
      jobScheduler,
      dispatchNotificationsFromEvent,
    } = setup();
    deliveryPartyLookup.seedParties('1', {
      sender: 'GSENDER',
      recipient: 'GRECIPIENT',
      driver: 'GDRIVER',
    });
    userContactLookup.seedAddress('GSENDER', { userId: 'user-1', email: 'sender@example.com' });
    userContactLookup.seedAddress('GDRIVER', { userId: 'user-driver', email: 'driver@example.com' });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['delivery_confirmed'],
        payload: ['1'],
      }),
    );

    const notifications = notificationRepository.all();
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.userId).sort()).toEqual(['user-1', 'user-driver']);
    expect(notifications.every((n) => n.type === 'delivery.delivery_confirmed')).toBe(true);
    expect(notifications.every((n) => n.payload.chainDeliveryId === '1')).toBe(true);
    expect(jobScheduler.enqueued).toHaveLength(2);
  });

  it('escrow.delivery_disputed: notifies the disputing party, reading the id from the topic', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress(testAddress('sender'), {
      userId: 'user-2',
      email: 'sender@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['delivery_disputed', '7'],
        payload: [testAddress('sender')],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-2', type: 'escrow.delivery_disputed', payload: { chainDeliveryId: '7' } },
    ]);
  });

  it('escrow.escrow_released: notifies the driver, reading the id from the topic and the address from payload[0]', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress(testAddress('driver'), {
      userId: 'user-driver',
      email: 'driver@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'escrow',
        topic: ['escrow_released', '9'],
        payload: [testAddress('driver'), '1000', '25'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-driver', type: 'escrow.escrow_released', payload: { chainDeliveryId: '9' } },
    ]);
  });

  it('dispute.dispute_raised: notifies the raiser, parsing the tuple-wrapped delivery id', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress(testAddress('raiser'), {
      userId: 'user-3',
      email: 'raiser@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'dispute-resolution',
        topic: ['dispute_raised', '["3"]'],
        payload: [testAddress('raiser')],
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
    userContactLookup.seedAddress(testAddress('driver'), {
      userId: 'user-4',
      email: 'driver@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'identity-reputation',
        topic: [eventName],
        payload: [testAddress('driver'), '10'],
      }),
    );

    expect(notificationRepository.all()).toMatchObject([
      { userId: 'user-4', type: `reputation.${eventName}` },
    ]);
  });

  it('fleet.fleet_registered: notifies the fleet owner', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress(testAddress('owner'), {
      userId: 'user-5',
      email: 'owner@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'fleet',
        topic: ['fleet_registered'],
        payload: ['1', testAddress('owner'), testAddress('treasury')],
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
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-6',
        email: 'driver@example.com',
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'fleet',
          topic: [eventName],
          payload: ['1', testAddress('driver')],
        }),
      );

      expect(notificationRepository.all()).toMatchObject([
        { userId: 'user-6', type: `fleet.${eventName}` },
      ]);
    },
  );

  it('skips delivery_created even though its payload does carry an address (sender) — self-action, not a useful notification', async () => {
    const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
    userContactLookup.seedAddress(testAddress('sender'), {
      userId: 'user-7',
      email: 'sender@example.com',
    });

    await dispatchNotificationsFromEvent(
      buildBlockchainEvent({
        contractName: 'delivery',
        topic: ['delivery_created'],
        payload: ['1', testAddress('sender')],
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
        payload: ['1', testAddress('unlinked')],
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

  // #698 — per-user preference gate
  describe('notification preference gate', () => {
    it('creates a notification when the user has no stored preference (default-enabled)', async () => {
      const { notificationRepository, userContactLookup, dispatchNotificationsFromEvent } = setup();
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-1',
        email: 'driver@example.com',
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'delivery',
          topic: ['driver_assigned'],
          payload: ['1', testAddress('driver')],
        }),
      );

      expect(notificationRepository.all()).toHaveLength(1);
    });

    it('creates a notification when the preference row exists but disabled is false', async () => {
      const {
        notificationRepository,
        userContactLookup,
        notificationPreferenceRepository,
        dispatchNotificationsFromEvent,
      } = setup();
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-enabled',
        email: 'driver@example.com',
      });
      await notificationPreferenceRepository.upsert({
        userId: 'user-enabled',
        eventType: 'DELIVERY_DRIVER_ASSIGNED',
        disabled: false,
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'delivery',
          topic: ['driver_assigned'],
          payload: ['1', testAddress('driver')],
        }),
      );

      expect(notificationRepository.all()).toHaveLength(1);
    });

    it('suppresses notification creation when the user has disabled the event type', async () => {
      const {
        notificationRepository,
        userContactLookup,
        jobScheduler,
        notificationPreferenceRepository,
        dispatchNotificationsFromEvent,
      } = setup();
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-opt-out',
        email: 'driver@example.com',
      });
      await notificationPreferenceRepository.upsert({
        userId: 'user-opt-out',
        eventType: 'DELIVERY_DRIVER_ASSIGNED',
        disabled: true,
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'delivery',
          topic: ['driver_assigned'],
          payload: ['1', testAddress('driver')],
        }),
      );

      expect(notificationRepository.all()).toHaveLength(0);
      expect(jobScheduler.enqueued).toHaveLength(0);
    });

    it("suppressing one user's preference does not affect other users for the same event", async () => {
      const {
        notificationRepository,
        userContactLookup,
        deliveryPartyLookup,
        notificationPreferenceRepository,
        dispatchNotificationsFromEvent,
      } = setup();
      deliveryPartyLookup.seedParties('10', {
        sender: testAddress('sender'),
        recipient: testAddress('recipient'),
        driver: testAddress('driver'),
      });
      userContactLookup.seedAddress(testAddress('sender'), {
        userId: 'user-sender',
        email: 'sender@example.com',
      });
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-driver',
        email: 'driver@example.com',
      });
      // Sender opts out of DELIVERY_CONFIRMED; driver keeps default (enabled)
      await notificationPreferenceRepository.upsert({
        userId: 'user-sender',
        eventType: 'DELIVERY_CONFIRMED',
        disabled: true,
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'delivery',
          topic: ['delivery_confirmed'],
          payload: ['10'],
        }),
      );

      const notifications = notificationRepository.all();
      // Only the driver receives a notification; the sender is suppressed.
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.userId).toBe('user-driver');
    });

    it('suppresses all candidates for a multi-party event when all have opted out', async () => {
      const {
        notificationRepository,
        userContactLookup,
        deliveryPartyLookup,
        notificationPreferenceRepository,
        dispatchNotificationsFromEvent,
      } = setup();
      deliveryPartyLookup.seedParties('11', {
        sender: testAddress('sender'),
        recipient: testAddress('recipient'),
        driver: testAddress('driver'),
      });
      userContactLookup.seedAddress(testAddress('sender'), {
        userId: 'user-s',
        email: 'sender@example.com',
      });
      userContactLookup.seedAddress(testAddress('driver'), {
        userId: 'user-d',
        email: 'driver@example.com',
      });
      await notificationPreferenceRepository.upsert({
        userId: 'user-s',
        eventType: 'DELIVERY_CONFIRMED',
        disabled: true,
      });
      await notificationPreferenceRepository.upsert({
        userId: 'user-d',
        eventType: 'DELIVERY_CONFIRMED',
        disabled: true,
      });

      await dispatchNotificationsFromEvent(
        buildBlockchainEvent({
          contractName: 'delivery',
          topic: ['delivery_confirmed'],
          payload: ['11'],
        }),
      );

      expect(notificationRepository.all()).toHaveLength(0);
    });
  });
});
