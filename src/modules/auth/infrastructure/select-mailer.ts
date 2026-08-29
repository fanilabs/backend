import type { Env } from '../../../shared/config/env.js';
import type { Mailer } from '../domain/index.js';
import { createLoggerMailer } from './logger-mailer.js';

/**
 * Selects the real `Mailer` adapter from config, refusing the
 * logging-only default in production. `createLoggerMailer` is a genuinely
 * functional dev/test default (docs/AUTHENTICATION.md), not a stub, but a
 * production deployment that never swapped in a real provider should fail
 * loudly at boot instead of silently delivering no mail — see issue
 * "logger adapters wired unconditionally in production" (docs/DEPLOYMENT.md).
 */
export function selectMailer(nodeEnv: Env['NODE_ENV'], provider: Env['MAIL_PROVIDER']): Mailer {
  if (provider === 'logger') {
    if (nodeEnv === 'production') {
      throw new Error(
        'MAIL_PROVIDER=logger is not allowed when NODE_ENV=production — configure a real mail ' +
          'provider before deploying (see docs/AUTHENTICATION.md § Dev email delivery).',
      );
    }
    return createLoggerMailer();
  }

  // Exhaustive per the MAIL_PROVIDER enum in env.ts; a new provider value
  // must add a branch here before it can be selected.
  throw new Error(`Unsupported MAIL_PROVIDER: ${String(provider)}`);
}
