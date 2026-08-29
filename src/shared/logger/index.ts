import pino, { type LoggerOptions } from 'pino';
import { getConfig } from '../config/index.js';

/**
 * Single Pino instance for the whole process. Module code should call
 * `logger.child({ module: 'deliveries' })` rather than constructing new
 * root loggers, so log output stays structured and filterable.
 */
/**
 * Quiet by default in `test` unless a level is explicitly requested — tests
 * assert on behavior, not log output, and Fastify's own request logging
 * option for this is deprecated as of Fastify 5 (FSTDEP023), so this is
 * handled here instead of via a per-instance Fastify flag. The "unless
 * explicit" part of that rule lives in the env schema's own `.transform`
 * (src/shared/config/env.ts), not here — this module only ever reads the
 * already-validated result, so an invalid LOG_LEVEL fails with the config
 * module's own clear error instead of a raw Pino crash at construction time.
 */
const config = getConfig();

/**
 * Exported separately from `options` so it can be unit-tested directly
 * (`redact.spec.ts`) without spinning up the whole process-wide logger.
 * `'*.token'`-style paths only match a key nested one level under the
 * merge object (`log.info({ foo: { token } })`) — they do NOT match a bare
 * top-level key (`log.info({ token })`), which is exactly the shape
 * `createLoggerMailer`/`createLoggerNotificationSender` log. Verified
 * against Pino's own redaction behavior — the mailer's raw verification/
 * reset tokens were not being redacted at all before the bare keys below
 * were added.
 */
export const redactConfig: LoggerOptions['redact'] = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    '*.password',
    '*.passwordHash',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
  ],
  remove: true,
};

const options: LoggerOptions = {
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    remove: true,
  },
};

if (config.NODE_ENV === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  };
}

export const logger = pino(options);

export type Logger = typeof logger;
