import { logger } from '../../../shared/logger/index.js';
import { NotificationNotFoundError, RecipientContactNotFoundError } from '../domain/index.js';
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
 * still-retrying send as permanently failed (see #104). A recipient with no
 * resolvable contact email yet is treated the same way on non-final
 * attempts (#354): returning void would let BullMQ mark the job completed
 * while the row stayed `PENDING` forever.
 */
export function createSendNotificationUseCase(deps: SendNotificationDeps) {
  return async function sendNotification(input: SendNotificationInput): Promise<void> {
    const notification = await deps.notificationRepository.findById(input.notificationId);
    if (!notification) throw new NotificationNotFoundError();

    if (notification.status === 'SENT') return;

    // The persisted `NotificationChannel` enum has three variants, but
    // `deps.sender` is always the single, EMAIL-shaped adapter wired at
    // module composition (`notifications/index.ts`) — nothing in this
    // codebase can actually deliver SMS/PUSH today (see `NotificationSender`'s
    // doc comment). Sending an SMS/PUSH row through the email sender would
    // silently deliver it to the wrong channel (or the wrong recipient
    // field entirely); no retry could ever fix this, so it's marked FAILED
    // immediately rather than going through the isFinalAttempt-gated path
    // below, which exists for genuinely transient failures.
    if (notification.channel !== 'EMAIL') {
      await deps.notificationRepository.markFailed(
        notification.id,
        `No sender configured for channel ${notification.channel}`,
      );
      log.error(
        { notificationId: notification.id, channel: notification.channel },
        'Notification channel has no configured sender — marking failed without attempting delivery',
      );
      return;
    }

    const isFinalAttempt = input.isFinalAttempt ?? true;

    const contact = await deps.userContactLookup.findByUserId(notification.userId);
    if (!contact) {
      if (isFinalAttempt) {
        await deps.notificationRepository.markFailed(
          notification.id,
          'No contact email found for notification recipient',
        );
        log.error(
          { notificationId: notification.id, userId: notification.userId, isFinalAttempt },
          'No contact email found for notification recipient',
        );
        return;
      }
      // A missing contact is usually transient (the user's email hasn't been
      // indexed/confirmed yet — which is exactly why this lookup re-resolves
      // per attempt instead of capturing the address at dispatch time).
      // Returning void here would make BullMQ treat the job as *completed*
      // on attempt 1 and drop it from the retry queue while the row stayed
      // `PENDING` forever (#354), so a non-final attempt rethrows to schedule
      // a backoff retry; the row is only marked `FAILED` once `isFinalAttempt`.
      log.warn(
        { notificationId: notification.id, userId: notification.userId },
        'No contact email found for notification recipient — retrying',
      );
      throw new RecipientContactNotFoundError(notification.id);
    }

    try {
      await deps.sender.send({
        to: contact.email,
        type: notification.type,
        payload: notification.payload,
      });
    } catch (error: unknown) {
      if (isFinalAttempt) {
        await deps.notificationRepository.markFailed(
          notification.id,
          error instanceof Error ? error.message : String(error),
        );
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
