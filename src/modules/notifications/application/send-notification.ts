import { logger } from '../../../shared/logger/index.js';
import { NotificationNotFoundError } from '../domain/index.js';
import type {
  NotificationRepository,
  NotificationSender,
  UserContactLookup,
} from '../domain/index.js';

const log = logger.child({ module: 'send-notification' });

export interface SendNotificationDeps {
  notificationRepository: NotificationRepository;
  userContactLookup: UserContactLookup;
  sender: NotificationSender;
}

export interface SendNotificationInput {
  notificationId: string;
  /**
   * Whether this is the last attempt BullMQ will make for this job (i.e.
   * `job.attemptsMade + 1 >= job.opts.attempts`). Defaults to `true` when
   * omitted — callers outside the worker (tests, one-off invocations) get
   * the conservative old behavior of marking `FAILED` immediately rather
   * than silently under-reporting a permanent failure as still-pending.
   */
  isFinalAttempt?: boolean;
}

/**
 * Run by the `notifications` BullMQ worker (`infrastructure/queue.ts`) for
 * every job `dispatchNotificationsFromEvent` enqueues. Re-resolves the
 * recipient's current email (see `UserContactLookup.findByUserId`'s header
 * comment) rather than trusting a value captured at dispatch time, then
 * delegates to whichever channel adapter `notifications/index.ts` wired up
 * (a real SMTP sender, or the unconfigured fallback that always throws —
 * see that file). A send failure always rethrows, so BullMQ's own
 * retry/backoff (`shared/queue/queues.ts` — 5 attempts, exponential) gets a
 * chance to succeed on a later attempt — but the row is only marked
 * `FAILED` when `isFinalAttempt` is true; an intermediate failure leaves it
 * `PENDING` so `GET /notifications?status=FAILED` never reports a
 * still-retrying send as permanently failed (see #104).
 */
export function createSendNotificationUseCase(deps: SendNotificationDeps) {
  return async function sendNotification(input: SendNotificationInput): Promise<void> {
    const notification = await deps.notificationRepository.findById(input.notificationId);
    if (!notification) throw new NotificationNotFoundError();

    if (notification.status === 'SENT') return;

    const isFinalAttempt = input.isFinalAttempt ?? true;

    const contact = await deps.userContactLookup.findByUserId(notification.userId);
    if (!contact) {
      if (isFinalAttempt) {
        await deps.notificationRepository.markFailed(notification.id);
      }
      log.error(
        { notificationId: notification.id, userId: notification.userId, isFinalAttempt },
        'No contact email found for notification recipient',
      );
      return;
    }

    try {
      await deps.sender.send({
        to: contact.email,
        type: notification.type,
        payload: notification.payload,
      });
    } catch (error: unknown) {
      if (isFinalAttempt) {
        await deps.notificationRepository.markFailed(notification.id);
      } else {
        log.warn(
          { notificationId: notification.id, err: error },
          'Notification send attempt failed, retry pending',
        );
      }
      throw error;
    }

    await deps.notificationRepository.markSent(notification.id, new Date());
  };
}
