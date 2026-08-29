import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { redactConfig } from './index.js';

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const log = pino({ redact: redactConfig }, stream);
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
