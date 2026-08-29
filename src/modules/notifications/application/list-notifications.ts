import type { Notification, NotificationRepository, NotificationStatus } from '../domain/index.js';

export interface ListNotificationsDeps {
  notificationRepository: NotificationRepository;
}

export interface ListNotificationsInput {
  userId: string;
  status?: NotificationStatus;
  limit?: number;
  /** ISO timestamp cursor — returns only notifications older than this,
   * i.e. the `nextCursor` from a previous page's response. */
  before?: string;
}

export interface ListNotificationsResult {
  items: Notification[];
  /** ISO timestamp to pass as `before` to fetch the next page, or `null`
   * once the last page has been reached (fewer than `limit` rows came
   * back, so there is nothing older left to page through). */
  nextCursor: string | null;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Always scoped to the requesting user (`interface/routes.ts` passes
 * `request.user.id`, never a caller-supplied id) — there is no notion of
 * an admin reading another user's notifications in this v1 slice.
 *
 * Paginated via an opaque `before` cursor (the previous page's oldest
 * `createdAt`) rather than `skip`/offset, so results stay stable even as
 * new notifications are dispatched between page fetches — see #96/#101. */
export function createListNotificationsUseCase(deps: ListNotificationsDeps) {
  return async function listNotifications(
    input: ListNotificationsInput,
  ): Promise<ListNotificationsResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const items = await deps.notificationRepository.listByUserId(input.userId, {
      limit,
      ...(input.status && { status: input.status }),
      ...(input.before && { before: new Date(input.before) }),
    });

    const nextCursor = items.length === limit ? items[items.length - 1].createdAt.toISOString() : null;

    return { items, nextCursor, limit };
  };
}
