import { logger } from '../../../shared/logger/index.js';
import type { Mailer } from '../domain/index.js';

const log = logger.child({ module: 'auth-mailer' });

/**
 * Development-default Mailer: logs the email content (including the raw
 * token, so it's readable straight from the logs during local development
 * and CI) instead of sending anything. This is a genuinely functional
 * implementation of the Mailer port, not a stub — swap in a real provider
 * (SES, SendGrid, Postmark, ...) behind the same interface when one is
 * needed; see docs/AUTHENTICATION.md.
 */
export function createLoggerMailer(): Mailer {
  return {
    async sendVerificationEmail(to, token) {
      log.info({ to, token }, 'Verification email (logged, not sent — see LoggerMailer)');
    },
    async sendPasswordResetEmail(to, token) {
      log.info({ to, token }, 'Password reset email (logged, not sent — see LoggerMailer)');
    },
  };
}
