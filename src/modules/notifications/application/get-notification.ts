import type { Notification, NotificationRepository } from '../domain/index.js';
import { ForbiddenNotificationAccessError, NotificationNotFoundError } from '../domain/index.js';

export interface GetNotificationDeps {
  notificationRepository: NotificationRepository;
}

export interface GetNotificationInput {
  userId: string;
  notificationId: string;
}

export function createGetNotificationUseCase(deps: GetNotificationDeps) {
  return async function getNotification(input: GetNotificationInput): Promise<Notification> {
    const notification = await deps.notificationRepository.findById(input.notificationId);
    if (!notification) throw new NotificationNotFoundError();
    if (notification.userId !== input.userId) throw new ForbiddenNotificationAccessError();
    return notification;
  };
}
