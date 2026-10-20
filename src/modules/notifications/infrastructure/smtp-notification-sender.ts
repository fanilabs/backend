import { renderNotificationTemplate } from './templates.js';
import { createSmtpClient, type SmtpSettings } from '../../../shared/smtp/index.js';
import type { NotificationSender } from '../domain/index.js';

/**
 * Production-capable `NotificationSender` for the `smtp`/`sendgrid`/`ses`
 * providers — the notifications-module counterpart of auth's
 * `smtp-mailer.ts`, delivering over the same SMTP relay (all three providers
 * expose one). Selected by `select-notification-sender.ts`; a send failure
 * rejects so `sendNotification` maps it to a `FAILED` row and BullMQ's
 * retry/backoff takes over (src/modules/notifications/application/
 * send-notification.ts).
 */
export function createSmtpNotificationSender(settings: SmtpSettings): NotificationSender {
  const client = createSmtpClient(settings);
  return {
    async send({ to, type, payload }) {
      const rendered = renderNotificationTemplate(type, payload);
      await client.send({
        to,
        subject: rendered.subject,
        text: rendered.text,
      });
    },
  };
}
