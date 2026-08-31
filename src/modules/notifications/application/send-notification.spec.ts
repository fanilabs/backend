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

    expect((await notificationRepository.findById(notification.id))?.status).toBe('FAILED');
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

    expect((await notificationRepository.findById(notification.id))?.status).toBe('FAILED');
  });
});
