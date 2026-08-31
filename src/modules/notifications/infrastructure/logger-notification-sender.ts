import { logger } from '../../../shared/logger/index.js';
import type { NotificationSender } from '../domain/index.js';

const log = logger.child({ module: 'notifications-sender' });

/**
 * Default `NotificationSender`: logs the notification instead of sending
 * real email — the same "genuinely functional dev-default, not a stub"
 * approach `auth`'s own `createLoggerMailer` already established for this
 * codebase (`src/modules/auth/infrastructure/logger-mailer.ts`,
 * `docs/AUTHENTICATION.md`). Swap in a real provider (SES/SendGrid/
 * Postmark/...) behind the same `NotificationSender` port when one is
 * needed — nothing else in this module changes.
 */
export function createLoggerNotificationSender(): NotificationSender {
  return {
    async send({ to, type, payload }) {
      log.info(
        { to, type, payload },
        'Notification email (logged, not sent — see LoggerNotificationSender)',
      );
    },
  };
}
