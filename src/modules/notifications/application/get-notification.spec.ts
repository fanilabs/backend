import { describe, expect, it } from 'vitest';
import { createGetNotificationUseCase } from './get-notification.js';
import { ForbiddenNotificationAccessError, NotificationNotFoundError } from '../domain/index.js';
import { buildNotification, createInMemoryNotificationRepository } from './__fixtures__/fakes.js';

describe('getNotification', () => {
  it('returns the notification when it belongs to the requesting user', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const notification = buildNotification({ userId: 'user-1' });
    notificationRepository.seed(notification);
    const getNotification = createGetNotificationUseCase({ notificationRepository });

    const result = await getNotification({ userId: 'user-1', notificationId: notification.id });

    expect(result).toEqual(notification);
  });

  it('throws NotificationNotFoundError for an unknown id', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const getNotification = createGetNotificationUseCase({ notificationRepository });

    await expect(
      getNotification({ userId: 'user-1', notificationId: 'missing' }),
    ).rejects.toBeInstanceOf(NotificationNotFoundError);
  });

  it("throws ForbiddenNotificationAccessError for another user's notification", async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const notification = buildNotification({ userId: 'user-1' });
    notificationRepository.seed(notification);
    const getNotification = createGetNotificationUseCase({ notificationRepository });

    await expect(
      getNotification({ userId: 'user-2', notificationId: notification.id }),
    ).rejects.toBeInstanceOf(ForbiddenNotificationAccessError);
  });
});
