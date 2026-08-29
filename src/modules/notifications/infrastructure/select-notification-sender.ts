import type { Env } from '../../../shared/config/env.js';
import type { NotificationSender } from '../domain/index.js';
import { createLoggerNotificationSender } from './logger-notification-sender.js';

/**
 * Same production gate as auth's `selectMailer`
 * (src/modules/auth/infrastructure/select-mailer.ts) applied to the
 * notifications module's own logging-only default.
 */
export function selectNotificationSender(
  nodeEnv: Env['NODE_ENV'],
  provider: Env['NOTIFICATION_PROVIDER'],
): NotificationSender {
  if (provider === 'logger') {
    if (nodeEnv === 'production') {
      throw new Error(
        'NOTIFICATION_PROVIDER=logger is not allowed when NODE_ENV=production — configure a ' +
          'real notification provider before deploying (see docs/DEPLOYMENT.md).',
      );
    }
    return createLoggerNotificationSender();
  }

  // Exhaustive per the NOTIFICATION_PROVIDER enum in env.ts; a new provider
  // value must add a branch here before it can be selected.
  throw new Error(`Unsupported NOTIFICATION_PROVIDER: ${String(provider)}`);
}
