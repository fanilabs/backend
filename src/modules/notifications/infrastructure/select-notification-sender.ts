import type { Env } from '../../../shared/config/env.js';
import type { SmtpSettings } from '../../../shared/smtp/index.js';
import type { NotificationSender, NotificationSenderRegistry } from '../domain/index.js';
import { createLoggerNotificationSender } from './logger-notification-sender.js';
import { createSmtpNotificationSender } from './smtp-notification-sender.js';

/**
 * Same production gate as auth's `selectMailer`
 * (src/modules/auth/infrastructure/select-mailer.ts) applied to the
 * notifications module's own logging-only default: `logger` is refused in
 * production, while `smtp`/`sendgrid`/`ses` select the real SMTP-backed
 * sender (src/shared/smtp/smtp-client.ts) the same way selectMailer does.
 */
export function selectNotificationSender(
  nodeEnv: Env['NODE_ENV'],
  provider: Env['NOTIFICATION_PROVIDER'],
  smtp?: SmtpSettings,
): NotificationSender {
  if (provider === 'logger') {
    if (nodeEnv === 'production') {
      throw new Error(
        'NOTIFICATION_PROVIDER=logger is not allowed when NODE_ENV=production — configure a ' +
          'real notification provider (NOTIFICATION_PROVIDER=smtp with SMTP_*, or sendgrid/ses) ' +
          'before deploying (see docs/DEPLOYMENT.md).',
      );
    }
    return createLoggerNotificationSender();
  }

  // `smtp`/`sendgrid`/`ses` — exhaustive per the NOTIFICATION_PROVIDER enum
  // in env.ts; a new provider value must add a branch here before it can be
  // selected. env.ts refuses to parse a non-logger provider without
  // SMTP_HOST/SMTP_FROM, so a missing relay here can only come from code
  // calling this selector directly — fail with the same clarity anyway.
  if (!smtp) {
    throw new Error(
      `NOTIFICATION_PROVIDER=${provider} requires SMTP relay settings (SMTP_HOST and SMTP_FROM) — ` +
        'configure the SMTP relay before deploying.',
    );
  }
  return createSmtpNotificationSender(smtp);
}

export function createNotificationSenderRegistry(
  emailSender: NotificationSender,
  overrides?: Omit<NotificationSenderRegistry, 'EMAIL'>,
): NotificationSenderRegistry {
  return {
    EMAIL: emailSender,
    ...overrides,
  };
}
