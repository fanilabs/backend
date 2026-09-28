import type { Notification, NotificationRepository } from '../domain/index.js';
import { ForbiddenNotificationAccessError, NotificationNotFoundError } from '../domain/index.js';

export interface GetNotificationDeps {
  notificationRepository: NotificationRepository;
}

export interface GetNotificationInput {
  userId: string;
  notificationId: string;
}

/**
 * Builds the use case that retrieves a notification owned by a user.
 *
 * @param deps - Injected dependencies for the use case.
 * @param deps.notificationRepository - Repository used to retrieve the notification.
 * @returns An async `getNotification` function that resolves to the requested
 *   notification when it belongs to `input.userId`.
 * @throws {NotificationNotFoundError} If no notification exists for the requested id.
 * @throws {ForbiddenNotificationAccessError} If the notification belongs to another user.
 */
export function createGetNotificationUseCase(deps: GetNotificationDeps) {
  return async function getNotification(input: GetNotificationInput): Promise<Notification> {
    const notification = await deps.notificationRepository.findById(input.notificationId);
    if (!notification) throw new NotificationNotFoundError();
    if (notification.userId !== input.userId) throw new ForbiddenNotificationAccessError();
    return notification;
  };
}
