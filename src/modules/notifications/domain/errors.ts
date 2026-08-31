import { ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';

export class NotificationNotFoundError extends NotFoundError {
  constructor() {
    super('Notification not found');
  }
}

export class ForbiddenNotificationAccessError extends ForbiddenError {
  constructor() {
    super('This notification does not belong to the current user');
  }
}

// `NotificationDeliveryError` (a reserved-for-multi-channel-senders 502
// type) was removed here as part of #103: nothing ever threw it, and
// CONTRIBUTING.md's Code Standards prohibit exactly this "placeholder
// implementation" shape. `sendNotification` still catches and marks
// `FAILED` on whatever a real `NotificationSender.send` throws — reintroduce
// a dedicated error type only once a real implementation needs one.
