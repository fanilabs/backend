import type { NotificationRepository } from '../domain/index.js';

export interface MarkNotificationsReadDeps {
  notificationRepository: NotificationRepository;
}

export interface MarkNotificationsReadInput {
  userId: string;
}

export function createMarkNotificationsReadUseCase(deps: MarkNotificationsReadDeps) {
  return async function markNotificationsRead(
    input: MarkNotificationsReadInput,
  ): Promise<{ count: number }> {
    const count = await deps.notificationRepository.markAllRead(input.userId);
    return { count };
  };
}
