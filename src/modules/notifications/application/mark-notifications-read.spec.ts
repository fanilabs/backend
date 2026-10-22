import { describe, expect, it } from 'vitest';
import { createMarkNotificationsReadUseCase } from './mark-notifications-read.js';
import { buildNotification, createInMemoryNotificationRepository } from './__fixtures__/fakes.js';

describe('markNotificationsRead', () => {
  it("marks only the requesting user's unread notifications and returns the count", async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', readAt: new Date() }));
    notificationRepository.seed(buildNotification({ userId: 'user-2' }));
    const markNotificationsRead = createMarkNotificationsReadUseCase({ notificationRepository });

    const result = await markNotificationsRead({ userId: 'user-1' });
    const userNotifications = notificationRepository.all().filter((n) => n.userId === 'user-1');

    expect(result.count).toBe(1);
    expect(userNotifications.every((notification) => notification.readAt !== null)).toBe(true);
    expect(notificationRepository.all().find((n) => n.userId === 'user-2')?.readAt).toBeNull();
  });
});
