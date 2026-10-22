import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envSchemaKeys, parseEnv } from './env.js';

/**
 * Every variable documented in .env.example should correspond to a schema
 * key (and vice versa) — otherwise either an operator is told to set a
 * variable that does nothing (see the SETTLEMENT_CONTRACT_ID removal this
 * test was added alongside), or the schema silently requires something
 * .env.example never mentions.
 */
function readEnvExampleKeys(): string[] {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const contents = readFileSync(path, 'utf-8');
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line): line is string => Boolean(line) && !line.startsWith('#'))
    .map((line) => line.split('=')[0] ?? '');
}

const required = {
  DATABASE_URL: 'postgresql://fanilab:fanilab@localhost:5432/fanilab_backend_test?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseEnv', () => {
  it('derives distinct purpose-specific JWT secrets from the access secret by default', () => {
    const env = parseEnv(required);

    expect(env.JWT_VERIFICATION_SECRET).toBe(
      createHmac('sha256', required.JWT_ACCESS_SECRET).update('jwt-verification').digest('hex'),
    );
    expect(env.JWT_RESET_SECRET).toBe(
      createHmac('sha256', required.JWT_ACCESS_SECRET).update('jwt-password-reset').digest('hex'),
    );
    expect(env.JWT_VERIFICATION_SECRET).not.toBe(env.JWT_RESET_SECRET);
  });

  it('accepts explicitly configured purpose-specific JWT secrets', () => {
    const env = parseEnv({
      ...required,
      JWT_VERIFICATION_SECRET: 'v'.repeat(32),
      JWT_RESET_SECRET: 'r'.repeat(32),
    });

    expect(env.JWT_VERIFICATION_SECRET).toBe('v'.repeat(32));
    expect(env.JWT_RESET_SECRET).toBe('r'.repeat(32));
  });

  it('treats blank purpose-specific JWT secrets as unset', () => {
    const env = parseEnv({
      ...required,
      JWT_VERIFICATION_SECRET: '',
      JWT_RESET_SECRET: '',
    });

    expect(env.JWT_VERIFICATION_SECRET).not.toBe(required.JWT_ACCESS_SECRET);
    expect(env.JWT_RESET_SECRET).not.toBe(required.JWT_ACCESS_SECRET);
    expect(env.JWT_VERIFICATION_SECRET).not.toBe(env.JWT_RESET_SECRET);
  });

  it('rejects an invalid LOG_LEVEL with the standard configuration error', () => {
    expect(() => parseEnv({ ...required, LOG_LEVEL: 'verbose' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('defaults LOG_LEVEL to silent when NODE_ENV is test and no level is set', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'test' });
    expect(env.LOG_LEVEL).toBe('silent');
  });

  it('respects an explicit LOG_LEVEL even when NODE_ENV is test', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'test', LOG_LEVEL: 'debug' });
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('defaults LOG_LEVEL to info outside of test', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'development' });
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('accepts extra unknown environment variables without failing', () => {
    expect(() => parseEnv({ ...required, SOME_UNRELATED_VAR: 'x' })).not.toThrow();
  });

  it('keeps .env.example in sync with the schema (no undocumented or dead keys)', () => {
    const exampleKeys = readEnvExampleKeys().sort();
    expect(exampleKeys).toEqual([...envSchemaKeys].sort());
  });
});

describe('mail/notification provider validation', () => {
  it('accepts NODE_ENV=production when a real provider and its SMTP relay are configured (issue #374)', () => {
    const env = parseEnv({
      ...required,
      NODE_ENV: 'production',
      MAIL_PROVIDER: 'smtp',
      NOTIFICATION_PROVIDER: 'ses',
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'no-reply@example.com',
    });

    expect(env.MAIL_PROVIDER).toBe('smtp');
    expect(env.NOTIFICATION_PROVIDER).toBe('ses');
    expect(env.SMTP_PORT).toBe(587);
  });

  it('rejects a non-logger provider without its SMTP relay at parse time', () => {
    expect(() => parseEnv({ ...required, NODE_ENV: 'production', MAIL_PROVIDER: 'smtp' })).toThrow(
      /MAIL_PROVIDER=smtp requires SMTP_HOST and SMTP_FROM/,
    );
  });

  it('requires SMTP_USER and SMTP_PASSWORD to be set together for a non-logger provider', () => {
    expect(() =>
      parseEnv({
        ...required,
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'no-reply@example.com',
        SMTP_USER: 'relay-user',
      }),
    ).toThrow(/SMTP_USER and SMTP_PASSWORD to be set together/);
  });

  it('still parses NODE_ENV=production with the logger default — the refusal lives in the selectors', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'production' });
    expect(env.MAIL_PROVIDER).toBe('logger');
    expect(env.NOTIFICATION_PROVIDER).toBe('logger');
  });

  it('leaves SMTP settings unconstrained when both providers stay on logger', () => {
    expect(() => parseEnv({ ...required })).not.toThrow();
  });
});
