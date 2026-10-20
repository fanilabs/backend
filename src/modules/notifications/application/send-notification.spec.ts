import { describe, expect, it } from 'vitest';
import { createSendNotificationUseCase } from './send-notification.js';
import { NotificationNotFoundError } from '../domain/index.js';
import {
  buildNotification,
  createFakeNotificationSender,
  createFakeUserContactLookup,
  createInMemoryNotificationRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const notificationRepository = createInMemoryNotificationRepository();
  const userContactLookup = createFakeUserContactLookup();
  const sender = createFakeNotificationSender();
  const sendNotification = createSendNotificationUseCase({
    notificationRepository,
    userContactLookup,
    sender,
  });
  return { notificationRepository, userContactLookup, sender, sendNotification };
}

describe('sendNotification', () => {
  it('sends via the channel adapter and marks the row SENT', async () => {
    const { notificationRepository, userContactLookup, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'user-1' });
    notificationRepository.seed(notification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: 'driver@example.com' });

    await sendNotification({ notificationId: notification.id });

    expect(sender.sent).toMatchObject([{ to: 'driver@example.com', type: notification.type }]);
    const stored = await notificationRepository.findById(notification.id);
    expect(stored?.status).toBe('SENT');
    expect(stored?.sentAt).toBeInstanceOf(Date);
  });

  it('throws NotificationNotFoundError for an unknown id', async () => {
    const { sendNotification } = setup();

    await expect(sendNotification({ notificationId: 'missing' })).rejects.toBeInstanceOf(
      NotificationNotFoundError,
    );
  });

  it('is a no-op if the notification was already sent (idempotent under BullMQ retries)', async () => {
    const { notificationRepository, sender, sendNotification } = setup();
    const notification = buildNotification({
      status: 'SENT',
      sentAt: new Date('2026-01-01T00:00:00Z'),
    });
    notificationRepository.seed(notification);

    await sendNotification({ notificationId: notification.id });

    expect(sender.sent).toHaveLength(0);
  });

  it('marks FAILED and does not throw when the recipient has no resolvable contact', async () => {
    const { notificationRepository, sendNotification } = setup();
    const notification = buildNotification({ userId: 'ghost-user' });
    notificationRepository.seed(notification);

    await sendNotification({ notificationId: notification.id });

    expect(await notificationRepository.findById(notification.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'No contact email found for notification recipient',
    });
  });

  it('throws a retryable error when the contact is missing on a non-final attempt (issue #354)', async () => {
    const { notificationRepository, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'ghost-user' });
    notificationRepository.seed(notification);

    await expect(
      sendNotification({ notificationId: notification.id, isFinalAttempt: false }),
    ).rejects.toThrow(/contact email not found/i);

    // The row stays PENDING while BullMQ retries remain — only the final
    // attempt is allowed to flip it to FAILED.
    expect(sender.sent).toHaveLength(0);
    expect((await notificationRepository.findById(notification.id))?.status).toBe('PENDING');
  });

  it('marks FAILED without throwing when the contact is missing on the final attempt (issue #354)', async () => {
    const { notificationRepository, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'ghost-user' });
    notificationRepository.seed(notification);

    await expect(
      sendNotification({ notificationId: notification.id, isFinalAttempt: true }),
    ).resolves.toBeUndefined();

    expect(sender.sent).toHaveLength(0);
    expect(await notificationRepository.findById(notification.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'No contact email found for notification recipient',
    });
  });

  it('marks FAILED without touching the email sender for a persisted SMS row (issue #12)', async () => {
    const { notificationRepository, userContactLookup, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'user-1', channel: 'SMS' });
    notificationRepository.seed(notification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: 'driver@example.com' });

    await sendNotification({ notificationId: notification.id });

    expect(sender.sent).toHaveLength(0);
    expect(await notificationRepository.findById(notification.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'No sender configured for channel SMS',
    });
  });

  it('marks FAILED without touching the email sender for a persisted PUSH row', async () => {
    const { notificationRepository, userContactLookup, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'user-1', channel: 'PUSH' });
    notificationRepository.seed(notification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: 'driver@example.com' });

    await sendNotification({ notificationId: notification.id });

    expect(sender.sent).toHaveLength(0);
    expect(await notificationRepository.findById(notification.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'No sender configured for channel PUSH',
    });
  });

  it('marks FAILED and rethrows when the sender itself fails', async () => {
    const { notificationRepository, userContactLookup, sender, sendNotification } = setup();
    const notification = buildNotification({ userId: 'user-1' });
    notificationRepository.seed(notification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: 'driver@example.com' });
    sender.failNext();

    await expect(sendNotification({ notificationId: notification.id })).rejects.toThrow(
      'Simulated send failure',
    );

    expect(await notificationRepository.findById(notification.id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Simulated send failure',
    });
  });

  it('routes SMS and PUSH notifications to their registered channel sender when senderRegistry is configured (issue #457)', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const userContactLookup = createFakeUserContactLookup();
    const emailSender = createFakeNotificationSender();
    const smsSender = createFakeNotificationSender();
    const sendNotification = createSendNotificationUseCase({
      notificationRepository,
      userContactLookup,
      sender: emailSender,
      senderRegistry: {
        EMAIL: emailSender,
        SMS: smsSender,
      },
    });

    const smsNotification = buildNotification({ userId: 'user-1', channel: 'SMS' });
    notificationRepository.seed(smsNotification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: '+15550001111' });

    await sendNotification({ notificationId: smsNotification.id });

    expect(smsSender.sent).toMatchObject([{ to: '+15550001111', type: smsNotification.type }]);
    expect(emailSender.sent).toHaveLength(0);
    expect((await notificationRepository.findById(smsNotification.id))?.status).toBe('SENT');
  });

  it('retains unconfigured channels in PENDING deferred state without marking FAILED when senderRegistry is used (issue #457)', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const userContactLookup = createFakeUserContactLookup();
    const emailSender = createFakeNotificationSender();
    const sendNotification = createSendNotificationUseCase({
      notificationRepository,
      userContactLookup,
      sender: emailSender,
      senderRegistry: {
        EMAIL: emailSender,
      },
    });

    const pushNotification = buildNotification({ userId: 'user-1', channel: 'PUSH' });
    notificationRepository.seed(pushNotification);
    userContactLookup.seedUserId('user-1', { userId: 'user-1', email: 'driver@example.com' });

    await sendNotification({ notificationId: pushNotification.id });

    expect(emailSender.sent).toHaveLength(0);
    expect((await notificationRepository.findById(pushNotification.id))?.status).toBe('PENDING');
  });
});
