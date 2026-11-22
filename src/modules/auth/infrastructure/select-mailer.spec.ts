import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../shared/config/env.js';
import { smtpSettingsFromEnv, type SmtpSettings } from '../../../shared/smtp/index.js';
import { selectMailer } from './select-mailer.js';

const smtpSettings: SmtpSettings = {
  host: 'smtp.example.com',
  port: 587,
  user: 'apikey',
  password: 'secret',
  from: 'FaniLab <no-reply@example.com>',
};

const productionEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  NODE_ENV: 'production',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'FaniLab <no-reply@example.com>',
} as NodeJS.ProcessEnv;

describe('selectMailer', () => {
  it('returns the logger mailer in development', () => {
    const mailer = selectMailer('development', 'logger');
    expect(mailer.sendVerificationEmail).toBeTypeOf('function');
  });

  it('returns the logger mailer in test', () => {
    const mailer = selectMailer('test', 'logger');
    expect(mailer.sendVerificationEmail).toBeTypeOf('function');
  });

  it('throws a clear configuration error for logger in production', () => {
    expect(() => selectMailer('production', 'logger')).toThrow(/NODE_ENV=production/);
  });

  it('initializes successfully in production for every real provider (issue #374)', () => {
    for (const provider of ['smtp', 'sendgrid', 'ses'] as const) {
      const mailer = selectMailer('production', provider, smtpSettings);
      expect(mailer.sendVerificationEmail).toBeTypeOf('function');
      expect(mailer.sendPasswordResetEmail).toBeTypeOf('function');
    }
  });

  it('boots a production configuration end to end: parseEnv → settings → selector', () => {
    const env = parseEnv(productionEnv);
    const mailer = selectMailer(env.NODE_ENV, env.MAIL_PROVIDER, smtpSettingsFromEnv(env));
    expect(mailer.sendVerificationEmail).toBeTypeOf('function');
  });

  it('throws a clear configuration error when a real provider has no SMTP settings', () => {
    expect(() => selectMailer('production', 'smtp')).toThrow(/SMTP_HOST and SMTP_FROM/);
    expect(() => selectMailer('development', 'ses', undefined)).toThrow(
      /MAIL_PROVIDER=ses requires SMTP relay settings/,
    );
  });
});

describe('smtpSettingsFromEnv', () => {
  const baseEnv = {
    SMTP_HOST: 'smtp.test.invalid',
    SMTP_PORT: '2525',
    SMTP_USER: 'test-user',
    SMTP_PASSWORD: 'test-password',
    SMTP_FROM: 'Test Sender <sender@test.invalid>',
  } as NodeJS.ProcessEnv;

  it('returns undefined when host is missing', () => {
    const env = { ...baseEnv, SMTP_HOST: undefined } as NodeJS.ProcessEnv;
    expect(smtpSettingsFromEnv(env)).toBeUndefined();
  });

  it('returns undefined when from is missing', () => {
    const env = { ...baseEnv, SMTP_FROM: undefined } as NodeJS.ProcessEnv;
    expect(smtpSettingsFromEnv(env)).toBeUndefined();
  });

  it('forwards the exact port and optional fields verbatim', () => {
    const env = { ...baseEnv } as NodeJS.ProcessEnv;
    const settings = smtpSettingsFromEnv(env);
    expect(settings).toEqual({
      host: 'smtp.test.invalid',
      port: 2525,
      user: 'test-user',
      password: 'test-password',
      from: 'Test Sender <sender@test.invalid>',
    });
  });

  it('omits optional fields that are not provided rather than fabricating them', () => {
    const env = {
      SMTP_HOST: 'smtp.test.invalid',
      SMTP_FROM: 'sender@test.invalid',
    } as NodeJS.ProcessEnv;
    const settings = smtpSettingsFromEnv(env);
    expect(settings).toEqual({
      host: 'smtp.test.invalid',
      from: 'sender@test.invalid',
    });
    expect(settings?.port).toBeUndefined();
    expect(settings?.user).toBeUndefined();
    expect(settings?.password).toBeUndefined();
  });

  it('does not modify the input env object', () => {
    const env = { ...baseEnv } as NodeJS.ProcessEnv;
    const snapshot = { ...env };
    smtpSettingsFromEnv(env);
    expect(env).toEqual(snapshot);
  });
});
