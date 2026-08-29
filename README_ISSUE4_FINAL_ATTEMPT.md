# Issue 4: Only mark FAILED on the final BullMQ attempt

## What changed

`sendNotification` previously marked a notification row `FAILED` on the
*first* sender error and rethrew for BullMQ to retry — so a notification
that would succeed on attempt 3 spent the intervening backoff window
(seconds, given `shared/queue/queues.ts`'s 5-attempt exponential backoff)
advertising itself as permanently failed via `GET /notifications?status=FAILED`,
contradicting the function's own header comment.

- `SendNotificationInput` gained an optional `isFinalAttempt` boolean
  (defaults to `true` when omitted, e.g. for direct/test invocations outside
  the worker — conservative, matches the old behavior).
- `src/modules/notifications/infrastructure/queue.ts`'s worker now computes
  `isFinalAttempt` from `job.attemptsMade + 1 >= job.opts.attempts` and
  passes it through.
- The row is marked `FAILED` only when `isFinalAttempt` is true; otherwise
  it's left `PENDING` (an intermediate-failure warning is logged instead)
  and the error is still rethrown so BullMQ's retry/backoff proceeds
  unchanged.
- The already-`SENT` early return is untouched.
- The misleading header comment ("only the last, permanently-failed attempt
  leaves the row FAILED") is now accurate rather than aspirational.

## Not done in this pass

`send-notification.spec.ts` still calls `sendNotification({ notificationId })`
without `isFinalAttempt` — those cases keep exercising the (now correct)
default-`true` path, but the intermediate-attempt case the issue asks for
("fails twice then succeeds is never observed as FAILED") isn't covered by
a new test yet; no test runs were performed as part of this task.
