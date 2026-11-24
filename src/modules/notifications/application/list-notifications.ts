import type {
  Notification,
  NotificationChannel,
  NotificationCursor,
  NotificationRepository,
  NotificationStatus,
} from '../domain/index.js';

export interface ListNotificationsDeps {
  notificationRepository: NotificationRepository;
}

export interface ListNotificationsInput {
  userId: string;
  status?: NotificationStatus;
  /** When `true`, only unread (readAt is null) notifications are returned.
   * When `false`, only read notifications are returned.
   * Omitted means no read-state constraint. */
  unread?: boolean;
  /** When supplied, only notifications from this channel are returned. */
  channel?: NotificationChannel;
  limit?: number;
  /** Opaque composite cursor returned as `nextCursor` from a previous page.
   * Encodes both `createdAt` and `id` as a JSON base64 string so timestamp
   * ties never cause rows to be skipped or duplicated. */
  before?: string;
}

export interface ListNotificationsResult {
  items: Notification[];
  /** Opaque cursor to pass as `before` on the next request, or `null` once
   * the last page has been reached. The value is a base64-encoded JSON
   * object carrying both `createdAt` (ISO string) and `id` (UUID) — clients
   * must treat it as opaque and never construct it themselves. */
  nextCursor: string | null;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Encode a composite cursor to the opaque string clients pass as `before`. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64',
  );
}

/** Decode a client-supplied cursor. Returns `null` if the value is malformed
 * so the caller can silently treat it as "no cursor" rather than crashing. */
export function decodeCursor(raw: string): NotificationCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      return null;
    }
    const { createdAt, id } = parsed as { createdAt: string; id: string };
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

/**
 * Builds the use case that lists a user's notifications, newest first.
 *
 * Always scoped to the requesting user (`interface/routes.ts` passes
 * `request.user.id`, never a caller-supplied id) — there is no notion of
 * an admin reading another user's notifications in this v1 slice.
 *
 * Paginated via an opaque composite cursor (createdAt + id) rather than
 * `skip`/offset or a timestamp-only `before`, so results stay stable even
 * as new notifications are dispatched between page fetches and timestamp
 * ties never drop rows at a page boundary — see #695.
 *
 * The repository is asked for `limit + 1` rows. If more than `limit` come
 * back there is a next page, the cursor is built from item at index
 * `limit - 1` (the last item that belongs to this page), and the extra row
 * is stripped before returning. If exactly `limit` or fewer rows come back,
 * `nextCursor` is `null` — an exact-size final page no longer triggers a
 * spurious extra request.
 *
 * @param deps - Injected dependencies for the use case.
 * @returns An async `listNotifications` function.
 */
export function createListNotificationsUseCase(deps: ListNotificationsDeps) {
  return async function listNotifications(
    input: ListNotificationsInput,
  ): Promise<ListNotificationsResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const cursor = input.before ? decodeCursor(input.before) : undefined;

    // Fetch one extra row so we can tell whether there is a next page
    // without making a separate COUNT query.
    const rows = await deps.notificationRepository.listByUserId(input.userId, {
      limit: limit + 1,
      ...(input.status && { status: input.status }),
      ...(input.unread !== undefined && { unread: input.unread }),
      ...(input.channel !== undefined && { channel: input.channel }),
      ...(cursor && { cursor }),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

    return { items, nextCursor, limit };
  };
}
