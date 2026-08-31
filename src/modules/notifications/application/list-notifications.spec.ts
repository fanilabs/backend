import { describe, expect, it } from 'vitest';
import { createListNotificationsUseCase } from './list-notifications.js';
import { buildNotification, createInMemoryNotificationRepository } from './__fixtures__/fakes.js';

describe('listNotifications', () => {
  it("only returns the requesting user's own notifications", async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    notificationRepository.seed(buildNotification({ userId: 'user-2' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe('user-1');
  });

  it('filters by status when provided', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'SENT' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'PENDING' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', status: 'SENT' });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('SENT');
  });

  it('caps limit at 100 even if a larger value is requested', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 150; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', limit: 500 });

    expect(result).toHaveLength(100);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 30; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result).toHaveLength(20);
  });
});
