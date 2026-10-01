import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { errorSerializer, redactConfig } from './index.js';

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const log = pino(
    {
      redact: redactConfig,
      serializers: {
        err: errorSerializer,
        error: errorSerializer,
      },
    },
    stream,
  );
  return { log, output: () => chunks.join('') };
}

describe('redactConfig', () => {
  it('redacts a bare top-level token field — the exact shape LoggerMailer logs', () => {
    const { log, output } = captureLogger();

    log.info({ to: 'user@example.com', token: 'super-secret-token' }, 'Verification email');

    expect(output()).not.toContain('super-secret-token');
  });

  it('still redacts a one-level-nested token field', () => {
    const { log, output } = captureLogger();

    log.info({ payload: { token: 'nested-secret-token' } }, 'Notification');

    expect(output()).not.toContain('nested-secret-token');
  });

  it('does not redact unrelated fields', () => {
    const { log, output } = captureLogger();

    log.info({ to: 'user@example.com', token: 'secret' }, 'Verification email');

    expect(output()).toContain('user@example.com');
  });
});

describe('errorSerializer', () => {
  it('strips password and token from an Error object properties', () => {
    const { log, output } = captureLogger();

    const error = new Error('Database connection failed');
    (error as any).password = 'supersecret123';
    (error as any).token = 'secrettoken456';

    log.error({ err: error }, error.message);

    const logOutput = output();
    expect(logOutput).toContain('Database connection failed');
    expect(logOutput).not.toContain('supersecret123');
    expect(logOutput).not.toContain('secrettoken456');
  });

  it('strips sensitive fields and PII from nested details on an Error object', () => {
    const { log, output } = captureLogger();

    const error = new Error('Validation failed');
    (error as any).details = {
      user: 'alice',
      password: 'mypassword',
      token: 'jwt.token.value',
      credentials: { secret: 'topsecret' },
    };

    log.error({ err: error }, error.message);

    const logOutput = output();
    expect(logOutput).toContain('Validation failed');
    expect(logOutput).toContain('"user":"alice"');
    expect(logOutput).not.toContain('mypassword');
    expect(logOutput).not.toContain('jwt.token.value');
    expect(logOutput).not.toContain('topsecret');
  });

  it('preserves non-sensitive error properties and stack', () => {
    const { log, output } = captureLogger();

    const error = new Error('Payment failed');
    (error as any).code = 'INSUFFICIENT_FUNDS';
    (error as any).details = { amount: 100, currency: 'XLM' };

    log.error({ err: error }, error.message);

    const logOutput = output();
    expect(logOutput).toContain('Payment failed');
    expect(logOutput).toContain('INSUFFICIENT_FUNDS');
    expect(logOutput).toContain('"amount":100');
    expect(logOutput).toContain('"currency":"XLM"');
    expect(logOutput).toContain('stack');
  });
});
